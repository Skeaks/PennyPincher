/**
 * GET /v1/cells/:cellKey — the ladder for one cell (S11).
 *
 * Reads the last 72 h of the cell, collapses the rows to ONE vote per panelist, runs
 * `resolve()` from @pennypincher/stats over those votes, and returns the Resolution with the
 * counts a client needs to show it honestly. The response is cached for CELL_CACHE_SECONDS at
 * the edge.
 *
 * Why one vote per panelist: retailers hash-assign a shopper to a price tier and keep them
 * there, so a panelist who checks the same product five times has reported the same tier five
 * times, not sampled the ladder five times. S10 measured the cost of counting those repeats:
 * the wrong-tier rate above threshold went from 0.5% i.i.d. to 8.8% at stickiness 0.9 over 10
 * observers. The resolver deliberately reads nothing about who observed what; the dedupe is
 * this endpoint's job.
 */
import {
  DEFAULT_WINDOW_HOURS,
  type ObservationLike,
  type Resolution,
  explain,
  resolve,
} from "@pennypincher/stats";
import type { Context, Hono } from "hono";
import { activeSuspects } from "../ingest/abuse";
import type { ObservationRepo, ObservationRow } from "../repo/observations";

/** How long the edge serves one answer before recomputing it. */
export const CELL_CACHE_SECONDS = 60;

/** Longest cellKey the route accepts. Real keys are well under 100 characters. */
const MAX_CELL_KEY_LENGTH = 512;

export interface CellResponse {
  /** The key as requested: retailer|retailerStoreId|retailerSku|fulfillment|zip3. */
  cellKey: string;
  /** From @pennypincher/stats, computed over one vote per panelist. */
  resolution: Resolution;
  /** Votes the resolver saw: one per panelist, the latest. Equals `resolution.n`. */
  n: number;
  /** Distinct panelists who observed this cell inside the window. */
  panelists: number;
  /** Rows inside the window before the collapse. `observations - n` is how many were repeats. */
  observations: number;
  /** `observedAt` of the newest row inside the window; null when there is none. */
  latestObservedAt: string | null;
  /** Server time this answer was computed. A cached response keeps the original value. */
  updatedAt: string;
  /** `explain(resolution)`: the one line a client can show verbatim. */
  summary: string;
  windowHours: number;
}

/** The part of the Workers `Cache` interface the route uses. Tests hand in a Map-backed fake. */
export interface CellCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

export interface CellsDeps<E extends object> {
  repo: (env: E) => ObservationRepo;
  now: () => Date;
  /**
   * Returns the 401 response when the caller may not read, undefined when it may. Shared
   * with the ingest route so both endpoints check the same bearer the same way.
   */
  denied: (c: Context<{ Bindings: E }>) => Response | undefined;
  /**
   * The edge cache. `caches.default` in the Worker; omitted in tests unless a test is about
   * caching. Only responses that passed the bearer check are ever put in it.
   */
  cache?: (env: E) => CellCache | undefined;
  /** Structured log sink; the route reports when it excluded suspects (S14). */
  log?: (line: string) => void;
}

export function registerCellsRoute<E extends object>(
  app: Hono<{ Bindings: E }>,
  deps: CellsDeps<E>,
) {
  app.get("/v1/cells/:cellKey", async (c) => {
    const denied = deps.denied(c);
    if (denied) return denied;

    const cellKey = parseCellKey(c.req.param("cellKey"));
    if (cellKey === undefined) {
      return c.json(
        { errors: ["cellKey must be retailer|retailerStoreId|retailerSku|fulfillment|zip3"] },
        400,
      );
    }

    const cache = deps.cache?.(c.env);
    const key = cacheKey(c.req.url);
    const hit = await cache?.match(key);
    if (hit) return hit;

    const now = deps.now();
    const from = new Date(now.getTime() - DEFAULT_WINDOW_HOURS * 3_600_000);
    const repo = deps.repo(c.env);
    const all = await repo.listByCell(cellKey, from, now);
    // The abuse guard (S14): an unreviewed suspect's rows never reach the resolver.
    const suspects = activeSuspects(
      await repo.getFlags([...new Set(all.map((r) => r.panelistId))]),
    );
    const rows = suspects.size === 0 ? all : all.filter((r) => !suspects.has(r.panelistId));
    if (suspects.size > 0) {
      deps.log?.(
        JSON.stringify({
          event: "suspects_excluded",
          cellKey,
          panelists: suspects.size,
          rows: all.length - rows.length,
        }),
      );
    }
    const body = queryCell(cellKey, rows, now);

    const res = c.json(body, 200, { "cache-control": `public, max-age=${CELL_CACHE_SECONDS}` });
    if (cache) {
      const stored = cache.put(key, res.clone());
      // Under Workers the put runs after the response is sent. Hono throws when there is no
      // execution context (tests, Node), in which case we simply wait for it.
      try {
        c.executionCtx.waitUntil(stored);
      } catch {
        await stored;
      }
    }
    return res;
  });
}

/**
 * Compute the response body from one cell's rows. Pure; exported so tests can drive it
 * without HTTP. Rows outside `[now - 72 h, now]` are ignored even if the repo returned them.
 */
export function queryCell(
  cellKey: string,
  rows: readonly ObservationRow[],
  now: Date,
): CellResponse {
  const windowHours = DEFAULT_WINDOW_HOURS;
  const inWindow = withinWindow(rows, now, windowHours);
  const votes = onePerPanelist(inWindow);
  const resolution = resolve(votes.map(toObservationLike), { windowHours, now });
  const latest = inWindow.reduce<string | null>(
    (best, row) =>
      best === null || Date.parse(row.observedAt) > Date.parse(best) ? row.observedAt : best,
    null,
  );
  return {
    cellKey,
    resolution,
    n: resolution.n,
    panelists: votes.length,
    observations: inWindow.length,
    latestObservedAt: latest,
    updatedAt: now.toISOString(),
    summary: explain(resolution),
    windowHours,
  };
}

/**
 * One vote per panelist: the row with the latest `observedAt`. Ties fall to the later
 * `receivedAt`, then the greater `observationId`, so the choice is deterministic whatever
 * order the repo returned the rows in. The result is ascending by `observedAt`.
 */
export function onePerPanelist(rows: readonly ObservationRow[]): ObservationRow[] {
  const latest = new Map<string, ObservationRow>();
  for (const row of rows) {
    const current = latest.get(row.panelistId);
    if (current === undefined || isLater(row, current)) latest.set(row.panelistId, row);
  }
  return [...latest.values()].sort(
    (a, b) =>
      Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
      a.observationId.localeCompare(b.observationId),
  );
}

/** The slice of a row the resolver reads: when, how much, in what currency. */
function toObservationLike(row: ObservationRow): ObservationLike {
  return {
    observedAt: row.observedAt,
    facts: { price: { amountMinor: row.priceMinor, currency: row.currency } },
  };
}

function isLater(a: ObservationRow, b: ObservationRow): boolean {
  const byObserved = Date.parse(a.observedAt) - Date.parse(b.observedAt);
  if (byObserved !== 0) return byObserved > 0;
  const byReceived = Date.parse(a.receivedAt) - Date.parse(b.receivedAt);
  if (byReceived !== 0) return byReceived > 0;
  return a.observationId > b.observationId;
}

function withinWindow(
  rows: readonly ObservationRow[],
  now: Date,
  windowHours: number,
): ObservationRow[] {
  const toMs = now.getTime();
  const fromMs = toMs - windowHours * 3_600_000;
  return rows.filter((row) => {
    const t = Date.parse(row.observedAt);
    return !Number.isNaN(t) && t >= fromMs && t <= toMs;
  });
}

/**
 * A cellKey is exactly five pipe-separated parts (see `cellKey()` in repo/observations.ts).
 * Store id and zip3 may be empty; retailer, SKU and fulfillment may not. Returns undefined
 * for anything else so the route answers 400 instead of querying D1 with garbage.
 */
export function parseCellKey(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.length === 0 || raw.length > MAX_CELL_KEY_LENGTH) return undefined;
  const parts = raw.split("|");
  if (parts.length !== 5) return undefined;
  const [retailer, , sku, fulfillment] = parts;
  if (!retailer || !sku || !fulfillment) return undefined;
  return raw;
}

/**
 * The cache is keyed on the URL alone. Headers (the bearer among them) are dropped on
 * purpose: the check already ran, and every pilot client presents the same token anyway.
 */
function cacheKey(url: string): Request {
  return new Request(url, { method: "GET" });
}
