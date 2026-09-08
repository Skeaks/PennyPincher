/**
 * The query API as the report reads it: `GET /v1/cells/:cellKey` for the cells the export
 * says are worth asking about, and `GET /v1/adapter-health`. One interface so tests drive
 * the real Hono app in memory and production runs go over `fetch` with the pilot bearer.
 *
 * The bearer comes from the environment (`PILOT_TOKEN`), never a flag: flags land in shell
 * history. Requests carry no cookies or credentials of any kind; the token is a header.
 */
import type { CellResponse } from "api/src/routes/cells";

export interface ApiResult {
  status: number;
  body: unknown;
}

export interface ApiClient {
  getJson(path: string): Promise<ApiResult>;
}

export function fetchClient(baseUrl: string, token: string | undefined): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return {
    async getJson(path) {
      const res = await fetch(`${base}${path}`, { headers, credentials: "omit" });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { status: res.status, body };
    },
  };
}

/** Anything with Hono's `request(path)`; the tests wire `createApp()` in directly. */
export function appClient(app: {
  request(path: string): Response | Promise<Response>;
}): ApiClient {
  return {
    async getJson(path) {
      const res = await app.request(path);
      return { status: res.status, body: await res.json() };
    },
  };
}

export interface ApiCellsView {
  /** Cells asked about (those at or above the threshold in the export). */
  queried: number;
  resolved: number;
  multiTier: number;
  /** cellKey -> HTTP status for anything but 200. */
  errors: Record<string, number>;
  /** The newest `updatedAt` the API reported; null when nothing was queried. */
  at: string | null;
}

export async function queryCells(
  api: ApiClient,
  cellKeys: readonly string[],
): Promise<ApiCellsView> {
  const view: ApiCellsView = { queried: 0, resolved: 0, multiTier: 0, errors: {}, at: null };
  for (const cellKey of cellKeys) {
    view.queried++;
    const result = await api.getJson(`/v1/cells/${encodeURIComponent(cellKey)}`);
    if (result.status !== 200 || !isCellResponse(result.body)) {
      view.errors[cellKey] = result.status;
      continue;
    }
    const cell = result.body;
    if (view.at === null || cell.updatedAt > view.at) view.at = cell.updatedAt;
    if (cell.resolution.status === "RESOLVED") {
      view.resolved++;
      if (cell.resolution.tiers.length > 1) view.multiTier++;
    }
  }
  return view;
}

function isCellResponse(body: unknown): body is CellResponse {
  if (typeof body !== "object" || body === null) return false;
  const value = body as Record<string, unknown>;
  const resolution = value.resolution;
  return (
    typeof value.cellKey === "string" &&
    typeof value.updatedAt === "string" &&
    typeof resolution === "object" &&
    resolution !== null &&
    typeof (resolution as Record<string, unknown>).status === "string"
  );
}
