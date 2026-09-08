import { SCHEMA_VERSION, parseObservationBatch } from "@pennypincher/schema";
import { type Context, Hono } from "hono";
import {
  ABUSE_WINDOW_HOURS,
  activeSuspects,
  evaluateSuspect,
  panelistCells,
  suspectFlag,
} from "./ingest/abuse";
import { byPanelist, dedupeSemantic, twinSpan } from "./ingest/dedup";
import {
  RATE_LIMIT_PER_HOUR,
  demandsFor,
  overLimit,
  scopeOf,
  secondsUntilNextWindow,
  tokenKey,
  windowStart,
} from "./ingest/ratelimit";
import { type ObservationRepo, type ObservationRow, toRow } from "./repo/observations";
import { type ProductsRepo, resolveIdentities, skuKey } from "./repo/products";
import { type AdapterHealthRepo, registerAdapterHealthRoutes } from "./routes/adapter-health";
import { type CellCache, registerCellsRoute } from "./routes/cells";
import { registerPanelistsRoute } from "./routes/panelists";

export interface AppDeps<E> {
  /** Resolve the repo from the Worker bindings per request. Tests hand back a MemoryObservationRepo. */
  repo: (env: E) => ObservationRepo;
  /** Server clock, injectable for tests. */
  now?: () => Date;
  /**
   * Git SHA of the running build, from the deploy job (S08). Omitted or empty means a local
   * `wrangler dev` or a test, reported as "dev".
   */
  build?: (env: E) => string | undefined;
  /**
   * Pilot bearer token from `wrangler secret` (S08). Omitted or empty means both `/v1`
   * endpoints are open, which is only right for local dev and tests.
   */
  pilotToken?: (env: E) => string | undefined;
  /**
   * Edge cache for GET /v1/cells (S11). `caches.default` in the Worker; omitted in tests
   * unless the test is about caching.
   */
  cache?: (env: E) => CellCache | undefined;
  /**
   * Storage for the adapter health beacon (S12). D1 in the Worker; a memory repo in tests.
   * Omitted means the `/v1/adapter-health` routes are not mounted (404).
   */
  adapterHealth?: (env: E) => AdapterHealthRepo;
  /** Structured log sink (S14): abuse flags, deletions, purges. `console.log` in the Worker. */
  log?: (line: string) => void;
  /**
   * Product identity storage (S13). D1 in the Worker; a memory repo in tests. Omitted means
   * rows are stored with no canonical id (NULL), which is only right for tests that are not
   * about identity.
   */
  products?: (env: E) => ProductsRepo;
}

/**
 * The ingest and query API. Bearer-protected when a pilot token is configured.
 *
 *   GET    /healthz             -> 200 { ok, schemaVersion, build }
 *   POST   /v1/observations     -> 201 { accepted, duplicates } | 400 { errors: string[] }
 *                                  | 401 { errors: ["unauthorized"] } when the bearer is wrong
 *                                  | 429 { errors: [...] } + Retry-After over the hourly limit
 *   GET    /v1/cells/:cellKey   -> 200 CellResponse (see routes/cells.ts) | 400 | 401
 *   DELETE /v1/panelists/:id    -> 200 { panelistId, deleted } | 400 | 401
 *   POST   /v1/adapter-health   -> 201 { stored } | 400 | 401 (see routes/adapter-health.ts)
 *   GET    /v1/adapter-health   -> 200 AdapterHealthSummary[] | 401
 *
 * Ingest order (S14): validate, rate-limit check, semantic dedup, store, count against the
 * rate limit, abuse check. A batch refused by validation or the limit stores nothing.
 */
export function createApp<E extends object>(deps: AppDeps<E>) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => console.log(line));
  const app = new Hono<{ Bindings: E }>();

  /** The 401 response when a pilot token is configured and the caller did not present it. */
  const denied = (c: Context<{ Bindings: E }>): Response | undefined => {
    const expected = deps.pilotToken?.(c.env);
    if (expected && !bearerMatches(c.req.header("authorization"), expected)) {
      return c.json({ errors: ["unauthorized"] }, 401);
    }
    return undefined;
  };

  app.get("/healthz", (c) =>
    c.json({ ok: true, schemaVersion: SCHEMA_VERSION, build: deps.build?.(c.env) || "dev" }),
  );

  app.post("/v1/observations", async (c) => {
    const unauthorized = denied(c);
    if (unauthorized) return unauthorized;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ errors: ["body must be a JSON ObservationBatch"] }, 400);
    }
    // Schema validation + PII guard at the trust boundary. Anything that is not exactly an
    // ObservationBatch of the current schema version is rejected with the full error list.
    const parsed = parseObservationBatch(body);
    if (!parsed.ok) return c.json({ errors: parsed.errors }, 400);

    const at = now();
    const receivedAt = at.toISOString();
    // Product identity (S13): one resolution per distinct (retailer, SKU) in the batch,
    // before the rows are built so every row carries canonical_id and canonical_cell_key.
    const products = deps.products?.(c.env);
    const identities = products
      ? await resolveIdentities(products, parsed.batch.observations, receivedAt)
      : undefined;
    const rows = parsed.batch.observations.map((o) =>
      toRow(o, receivedAt, identities?.get(skuKey(o.retailer, o.product.retailerSku))),
    );
    const repo = deps.repo(c.env);

    // Rate limit: 1,000 rows an hour per bearer and per panelistId, fixed windows. Checked
    // before anything is stored; a refused batch is not counted either.
    const window = windowStart(at);
    const demands = demandsFor(rows, await tokenKey(deps.pilotToken?.(c.env)));
    const counts = await repo.rateCounts(
      demands.map((d) => d.key),
      window,
    );
    const refused = overLimit(counts, demands, RATE_LIMIT_PER_HOUR);
    if (refused) {
      return c.json(
        {
          errors: [
            `rate limit exceeded for ${scopeOf(refused)}: ${RATE_LIMIT_PER_HOUR} observations per hour`,
          ],
        },
        429,
        { "retry-after": String(secondsUntilNextWindow(at)) },
      );
    }

    // Semantic dedup against each panelist's stored rows around the batch's time span.
    const existing: ObservationRow[] = [];
    for (const [panelistId, group] of byPanelist(rows)) {
      const span = twinSpan(group);
      existing.push(...(await repo.listByPanelist(panelistId, span.from, span.to)));
    }
    const deduped = dedupeSemantic(rows, existing);
    const stored = await repo.insertMany(deduped.kept);
    await repo.rateAdd(demands, window);

    // Abuse guard over every (panelist, cell) the batch touched. Flags are logged and stored;
    // the rows stay. GET /v1/cells excludes unreviewed suspects from resolve().
    await flagSuspects(repo, deduped.kept, at, log);

    return c.json(
      { accepted: stored.accepted, duplicates: stored.duplicates + deduped.duplicates },
      201,
    );
  });

  registerCellsRoute(app, {
    repo: deps.repo,
    now,
    denied,
    log,
    ...(deps.cache ? { cache: deps.cache } : {}),
  });

  registerPanelistsRoute(app, { repo: deps.repo, denied, log });

  if (deps.adapterHealth) {
    registerAdapterHealthRoutes(app, { repo: deps.adapterHealth, now, denied });
  }

  app.notFound((c) => c.json({ errors: ["not found"] }, 404));

  return app;
}

/**
 * Run the abuse guard for each (panelist, cell) in the stored rows. One cell read per pair,
 * over the resolver's window; a panelist already flagged is skipped (the first flag sticks).
 */
async function flagSuspects(
  repo: ObservationRepo,
  rows: readonly ObservationRow[],
  now: Date,
  log: (line: string) => void,
): Promise<void> {
  const pairs = panelistCells(rows);
  if (pairs.length === 0) return;
  const from = new Date(now.getTime() - ABUSE_WINDOW_HOURS * 3_600_000);
  const known = activeSuspects(await repo.getFlags([...new Set(pairs.map((p) => p.panelistId))]));
  for (const { panelistId, cellKey } of pairs) {
    if (known.has(panelistId)) continue;
    const cellRows = await repo.listByCell(cellKey, from, now);
    const suspects = activeSuspects(
      await repo.getFlags([...new Set(cellRows.map((r) => r.panelistId))]),
    );
    const verdict = evaluateSuspect(panelistId, cellRows, suspects);
    if (!verdict.suspect || verdict.reason === undefined) continue;
    const flag = suspectFlag(panelistId, cellKey, verdict.reason, now);
    if (await repo.flagPanelist(flag)) {
      known.add(panelistId);
      log(JSON.stringify({ event: "panelist_flagged", ...flag }));
    }
  }
}

/** `Authorization: Bearer <token>`, compared in constant time so timing does not leak the token. */
function bearerMatches(header: string | undefined, expected: string): boolean {
  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(header ?? "");
  if (!match) return false;
  const given = new TextEncoder().encode(match[1]);
  const want = new TextEncoder().encode(expected);
  if (given.byteLength !== want.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < want.byteLength; i++) diff |= (given[i] ?? 0) ^ (want[i] ?? 0);
  return diff === 0;
}
