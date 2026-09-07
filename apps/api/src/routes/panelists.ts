/**
 * DELETE /v1/panelists/:id (S14): remove everything stored under one panelistId. The
 * extension's "Delete my data" calls it once per id it has ever used, then clears its own
 * storage. Same bearer as the other routes. Idempotent: deleting an id that has nothing on
 * file is 200 with `deleted: 0`, so a retry after a lost response is safe.
 *
 * The 60 s edge cache on GET /v1/cells is not purged; a cell the panelist contributed to
 * can show the old answer for up to a minute.
 */
import type { Context, Hono } from "hono";
import type { ObservationRepo } from "../repo/observations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeleteResponse {
  panelistId: string;
  /** Observation rows removed. */
  deleted: number;
}

export interface PanelistsDeps<E extends object> {
  repo: (env: E) => ObservationRepo;
  denied: (c: Context<{ Bindings: E }>) => Response | undefined;
  log: (line: string) => void;
}

export function registerPanelistsRoute<E extends object>(
  app: Hono<{ Bindings: E }>,
  deps: PanelistsDeps<E>,
) {
  app.delete("/v1/panelists/:id", async (c) => {
    const denied = deps.denied(c);
    if (denied) return denied;

    const panelistId = parsePanelistId(c.req.param("id"));
    if (panelistId === undefined) {
      return c.json({ errors: ["panelistId must be a UUID"] }, 400);
    }
    const result = await deps.repo(c.env).deletePanelist(panelistId);
    deps.log(
      JSON.stringify({ event: "panelist_deleted", panelistId, observations: result.observations }),
    );
    const body: DeleteResponse = { panelistId, deleted: result.observations };
    return c.json(body, 200);
  });
}

/** A UUID, matched exactly as stored: the schema keeps `panelistId` as the client sent it. */
export function parsePanelistId(raw: string | undefined): string | undefined {
  if (raw === undefined || !UUID.test(raw)) return undefined;
  return raw;
}
