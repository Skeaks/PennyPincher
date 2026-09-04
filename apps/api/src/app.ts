import { SCHEMA_VERSION, parseObservationBatch } from "@pennypincher/schema";
import { Hono } from "hono";
import { type ObservationRepo, toRow } from "./repo/observations";

export interface AppDeps<E> {
  /** Resolve the repo from the Worker bindings per request. Tests hand back a MemoryObservationRepo. */
  repo: (env: E) => ObservationRepo;
  /** Server clock, injectable for tests. */
  now?: () => Date;
}

/**
 * The ingest API. Open in dev; the pilot bearer token is added in S08, rate limiting in S14.
 *
 *   GET  /healthz          -> 200 { ok, schemaVersion }
 *   POST /v1/observations  -> 201 { accepted, duplicates } | 400 { errors: string[] }
 */
export function createApp<E extends object>(deps: AppDeps<E>) {
  const now = deps.now ?? (() => new Date());
  const app = new Hono<{ Bindings: E }>();

  app.get("/healthz", (c) => c.json({ ok: true, schemaVersion: SCHEMA_VERSION }));

  app.post("/v1/observations", async (c) => {
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
