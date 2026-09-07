/**
 * The extension's requests to PennyPincher's own API (S11, S12), and the only place that
 * makes them: the observation upload, the adapter health beacon (S12) and the cell (ladder)
 * query. All go to the configured API origin only, with the pilot bearer,
 * `credentials: "omit"` (no cookies, ever: ADR 0003), no cache, and redirects refused. This
 * is first-party traffic; the retailer-facing posture is the probe's (`src/probe/fetch.ts`)
 * and is unchanged.
 *
 * Three `fetch` call sites, pinned by test/probe/posture.test.ts: one POST helper shared by
 * the upload and the beacon, the GET for the cell, and the DELETE for a panelist (S14). A new
 * POST reuses the helper.
 */
import type { PriceObservation } from "@pennypincher/schema";
import type { AdapterHealthReport } from "../capture/health";
import type { SyncConfig } from "./config";

export const SYNC_FETCH_INIT = {
  credentials: "omit",
  cache: "no-store",
  redirect: "error",
} as const satisfies RequestInit;

/** What `POST /v1/observations` answers with. */
export type UploadResult =
  | { ok: true; accepted: number; duplicates: number }
  | { ok: false; reason: "http_error" | "network_error" | "bad_response"; status?: number };

/** What `DELETE /v1/panelists/:id` answers with (S14). `deleted` is the rows removed. */
export type DeleteResult =
  | { ok: true; deleted: number }
  | { ok: false; reason: "http_error" | "network_error" | "bad_response"; status?: number };

/** The slice of the API's cell response the popup reads (apps/api/src/routes/cells.ts). */
export interface CellSummary {
  cellKey: string;
  resolution:
    | {
        status: "RESOLVED";
        tiers: { price: number; share: number; n: number }[];
        floor: number;
        confidence: number;
        n: number;
        currency: string;
        windowHours: number;
      }
    | {
        status: "UNRESOLVED";
        reason: "no_observations" | "insufficient_n" | "rare_tier_unconfirmed" | "too_many_tiers";
        n: number;
        needed: number;
        tiersSeen: number;
        currency: string;
        windowHours: number;
      };
  n: number;
  panelists: number;
  observations: number;
  summary: string;
  updatedAt: string;
}

/** What `POST /v1/adapter-health` answers with. */
export type HealthPostResult =
  | { ok: true }
  | { ok: false; reason: "http_error" | "network_error"; status?: number };

export type CellFetch =
  | { ok: true; cell: CellSummary }
  | { ok: false; reason: "http_error" | "network_error" | "bad_response"; status?: number };

/** The parts of a Response these classifiers read, so a test can hand in a plain object. */
export interface ResponseLike {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

function isUploadBody(value: unknown): value is { accepted: number; duplicates: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { accepted: unknown }).accepted === "number" &&
    typeof (value as { duplicates: unknown }).duplicates === "number"
  );
}

export function isCellSummary(value: unknown): value is CellSummary {
  if (typeof value !== "object" || value === null) return false;
  const c = value as CellSummary;
  const r = c.resolution as { status?: unknown; n?: unknown } | undefined;
  return (
    typeof c.cellKey === "string" &&
    typeof c.summary === "string" &&
    typeof c.n === "number" &&
    typeof c.panelists === "number" &&
    typeof r === "object" &&
    r !== null &&
    (r.status === "RESOLVED" || r.status === "UNRESOLVED") &&
    typeof r.n === "number"
  );
}

export async function classifyUpload(response: ResponseLike): Promise<UploadResult> {
  if (!response.ok) return { ok: false, reason: "http_error", status: response.status };
  try {
    const body = await response.json();
    if (!isUploadBody(body)) return { ok: false, reason: "bad_response", status: response.status };
    return { ok: true, accepted: body.accepted, duplicates: body.duplicates };
  } catch {
    return { ok: false, reason: "bad_response", status: response.status };
  }
}

export async function classifyCell(response: ResponseLike): Promise<CellFetch> {
  if (!response.ok) return { ok: false, reason: "http_error", status: response.status };
  try {
    const body = await response.json();
    if (!isCellSummary(body)) return { ok: false, reason: "bad_response", status: response.status };
    return { ok: true, cell: body };
  } catch {
    return { ok: false, reason: "bad_response", status: response.status };
  }
}

function headers(config: SyncConfig, json: boolean): Record<string, string> {
  const h: Record<string, string> = { authorization: `Bearer ${config.token}` };
  if (json) h["content-type"] = "application/json";
  return h;
}

/** POST a JSON body to one of the API's `/v1` paths. The one POST call site; may throw. */
async function postJson(config: SyncConfig, path: string, body: unknown): Promise<ResponseLike> {
  return fetch(`${config.apiBaseUrl}${path}`, {
    ...SYNC_FETCH_INIT,
    method: "POST",
    headers: headers(config, true),
    body: JSON.stringify(body),
  });
}

/** Upload one batch (at most 200 rows, the API's limit). Never throws. */
export async function postObservations(
  config: SyncConfig,
  observations: readonly PriceObservation[],
): Promise<UploadResult> {
  try {
    const response = await postJson(config, "/v1/observations", { observations });
    return await classifyUpload(response);
  } catch {
    return { ok: false, reason: "network_error" };
  }
}

/** Upload one day's adapter health counts (S12). Never throws. */
export async function postAdapterHealth(
  config: SyncConfig,
  report: AdapterHealthReport,
): Promise<HealthPostResult> {
  try {
    const response = await postJson(config, "/v1/adapter-health", report);
    if (!response.ok) return { ok: false, reason: "http_error", status: response.status };
    return { ok: true };
  } catch {
    return { ok: false, reason: "network_error" };
  }
}

function isDeleteBody(value: unknown): value is { deleted: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { deleted: unknown }).deleted === "number"
  );
}

export async function classifyDelete(response: ResponseLike): Promise<DeleteResult> {
  if (!response.ok) return { ok: false, reason: "http_error", status: response.status };
  try {
    const body = await response.json();
    if (!isDeleteBody(body)) return { ok: false, reason: "bad_response", status: response.status };
    return { ok: true, deleted: body.deleted };
  } catch {
    return { ok: false, reason: "bad_response", status: response.status };
  }
}

/** Remove everything the server holds under one panelist id (S14). Never throws. */
export async function deletePanelist(
  config: SyncConfig,
  panelistId: string,
): Promise<DeleteResult> {
  const id = encodeURIComponent(panelistId);
  try {
    const response = await fetch(`${config.apiBaseUrl}/v1/panelists/${id}`, {
      ...SYNC_FETCH_INIT,
      method: "DELETE",
      headers: headers(config, false),
    });
    return await classifyDelete(response);
  } catch {
    return { ok: false, reason: "network_error" };
  }
}

/** The ladder for one cell. Never throws. */
export async function getCell(config: SyncConfig, cellKey: string): Promise<CellFetch> {
  try {
    const response = await fetch(`${config.apiBaseUrl}/v1/cells/${encodeURIComponent(cellKey)}`, {
      ...SYNC_FETCH_INIT,
      method: "GET",
      headers: headers(config, false),
    });
    return await classifyCell(response);
  } catch {
    return { ok: false, reason: "network_error" };
  }
}
