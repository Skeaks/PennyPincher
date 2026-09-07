/**
 * "Delete my data" (S14). Asks the server to remove every panelist id this browser has used,
 * then clears local state. Order matters: the ids are collected first (the identity record
 * plus every id still on stored rows), the server is asked, and only then is anything local
 * removed, so a failed run leaves everything in place for a retry. The endpoint is
 * idempotent, so a retry after a lost response is safe.
 *
 * Without a configured pilot token nothing was ever uploaded, so there is nothing to ask the
 * server for: local state is cleared and the outcome says so.
 */
import type { PriceObservation } from "@pennypincher/schema";
import { clearProbeState } from "../probe/state";
import { clear as clearObservations, list as listObservations } from "../store";
import { type SyncConfig, isConfigured, syncConfigFromEnv } from "../sync/config";
import { clearSyncState } from "../sync/state";
import { type DeleteResult, deletePanelist } from "../sync/transport";
import { clearPanelistIds, listPanelistIds } from "./panelist";

export interface DeleteDeps {
  config: () => SyncConfig;
  panelistIds: () => Promise<string[]>;
  observations: () => Promise<PriceObservation[]>;
  deletePanelist: (config: SyncConfig, panelistId: string) => Promise<DeleteResult>;
  /** Remove observations, probe results and sync state. */
  clearLocal: () => Promise<void>;
  clearPanelistIds: () => Promise<void>;
}

export type DeleteOutcome =
  /** Every id was removed from the server and everything local is gone. */
  | { status: "deleted"; ids: number; serverRows: number }
  /** No pilot token in this build: nothing was ever uploaded; local state is gone. */
  | { status: "local_only"; ids: number }
  /** The server could not be reached for `failed` of `ids`; nothing local was removed. */
  | { status: "failed"; ids: number; failed: number; failure: DeleteResult };

/** What the options page shows after a run. Pure; here so the page module stays UI-only. */
export function deleteOutcomeText(outcome: DeleteOutcome): string {
  const ids = `${outcome.ids} ID${outcome.ids === 1 ? "" : "s"}`;
  switch (outcome.status) {
    case "deleted":
      return `Done. The server removed ${outcome.serverRows} record${outcome.serverRows === 1 ? "" : "s"} under ${ids}, and everything stored on this computer is gone.`;
    case "local_only":
      return "Done. Everything stored on this computer is gone. This build never sent anything to a server, so there was nothing to remove there.";
    case "failed":
      return `Could not reach the server for ${outcome.failed} of ${ids}. Nothing was removed, here or there. Try again when you are online.`;
  }
}

export function defaultDeleteDeps(): DeleteDeps {
  return {
    config: syncConfigFromEnv,
    panelistIds: listPanelistIds,
    observations: listObservations,
    deletePanelist,
    clearLocal: async () => {
      await Promise.all([clearObservations(), clearProbeState(), clearSyncState()]);
    },
    clearPanelistIds,
  };
}

/** The ids to delete: the identity record's, then any other still on a stored row. Pure. */
export function idsToDelete(
  known: readonly string[],
  observations: readonly PriceObservation[],
): string[] {
  const ids = [...known];
  for (const o of observations) if (!ids.includes(o.panelistId)) ids.push(o.panelistId);
  return ids;
}

export async function deleteMyData(deps: DeleteDeps = defaultDeleteDeps()): Promise<DeleteOutcome> {
  const ids = idsToDelete(await deps.panelistIds(), await deps.observations());
  const config = deps.config();

  if (!isConfigured(config)) {
    await deps.clearLocal();
    await deps.clearPanelistIds();
    return { status: "local_only", ids: ids.length };
  }

  let serverRows = 0;
  let failed = 0;
  let failure: DeleteResult | undefined;
  for (const id of ids) {
    const result = await deps
      .deletePanelist(config, id)
      .catch((): DeleteResult => ({ ok: false, reason: "network_error" }));
    if (result.ok) serverRows += result.deleted;
    else {
      failed += 1;
      failure ??= result;
    }
  }
  if (failure) return { status: "failed", ids: ids.length, failed, failure };

  await deps.clearLocal();
  await deps.clearPanelistIds();
  return { status: "deleted", ids: ids.length, serverRows };
}
