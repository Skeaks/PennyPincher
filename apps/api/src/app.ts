import { SCHEMA_VERSION, parseObservationBatch } from "@pennypincher/schema";
import { Hono } from "hono";
import { type ObservationRepo, toRow } from "./repo/observations";

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
   * Pilot bearer token from `wrangler secret` (S08). Omitted or empty means the ingest
   * endpoint is open, which is only right for local dev and tests.
   */
  pilotToken?: (env: E) => string | undefined;
}

/**
 * The ingest API. Bearer-protected when a pilot token is configured; rate limiting in S14.
 *
 *   GET  /healthz          -> 200 { ok, schemaVersion, build }
 *   POST /v1/observations  -> 201 { accepted, duplicates } | 400 { errors: string[] }
 *                             | 401 { errors: ["unauthorized"] } when the bearer is wrong
 */
export function createApp<E extends object>(deps: AppDeps<E>) {
  const now = deps.now ?? (() => new Date());
  const app = new Hono<{ Bindings: E }>();

  app.get("/healthz", (c) =>
    c.json({ ok: true, schemaVersion: SCHEMA_VERSION, build: deps.build?.(c.env) || "dev" }),
  );

  app.post("/v1/observations", async (c) => {
    const expected = deps.pilotToken?.(c.env);
    if (expected && !bearerMatches(c.req.header("authorization"), expected)) {
      return c.json({ errors: ["unauthorized"] }, 401);
    }

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

    const receivedAt = now().toISOString();
    const rows = parsed.batch.observations.map((o) => toRow(o, receivedAt));
    const result = await deps.repo(c.env).insertMany(rows);
    return c.json(result, 201);
  });

  app.notFound((c) => c.json({ errors: ["not found"] }, 404));

  return app;
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
