# api

Ingest API: Hono on Cloudflare Workers with D1. Brief: `docs/sessions/S07-api-ingest.md`.

| Route | Result |
|---|---|
| `GET /healthz` | `200 { ok: true, schemaVersion }` |
| `POST /v1/observations` | body `ObservationBatch`; `201 { accepted, duplicates }` or `400 { errors: string[] }` |

`observationId` is the primary key. Resending a batch is safe: ids that already exist are
counted as `duplicates`, never rejected.

```bash
pnpm --filter api dev    # applies migrations to a local D1, then wrangler dev
pnpm --filter api test   # Vitest against the in-memory repo; no network
```

Layout: `src/app.ts` builds the Hono app from a repo factory; `src/repo/observations.ts` is the
repo interface plus row flattening and `cellKey`; `src/repo/d1.ts` and `src/repo/memory.ts`
implement it; `migrations/` holds the D1 schema.
