# api

Ingest + query API: Hono on Cloudflare Workers with D1. Briefs: `docs/sessions/S07-api-ingest.md`
(ingest), `docs/sessions/S11-query-api-and-ladder-ui.md` (query).

| Route | Result |
|---|---|
| `GET /healthz` | `200 { ok: true, schemaVersion, build }` (`build` is the git SHA the deploy job injected, `"dev"` locally) |
| `POST /v1/observations` | `Authorization: Bearer <PILOT_TOKEN>` (open when the secret is unset, i.e. local dev); body `ObservationBatch`; `201 { accepted, duplicates }`, `400 { errors: string[] }`, or `401` |
| `GET /v1/cells/:cellKey` | Same bearer. `cellKey` is `retailer\|retailerStoreId\|retailerSku\|fulfillment\|zip3` (percent-encode the pipes or not, both work). `200 CellResponse` cached 60 s at the edge, `400` on a malformed key, `401` |
| `DELETE /v1/panelists/:id` | Same bearer. Removes every row stored under the panelist id (observations, abuse flag, rate buckets). `200 { panelistId, deleted }` (`deleted: 0` for an unknown id, so retries are safe), `400` on a non-UUID, `401` |

`observationId` is the primary key. Resending a batch is safe: ids that already exist are
counted as `duplicates`, never rejected.

## Ingest hardening (S14)

The POST runs, in order: validate, rate-limit check, semantic dedup, store, count against the
limit, abuse check. A batch refused by validation or the limit stores nothing.

- **Rate limit.** 1,000 observations per hour per bearer token and per `panelistId`, in fixed
  windows on the hour, counted as presented (duplicates included). Over it: `429` with
  `Retry-After` (seconds to the next window) and nothing stored or counted. The token bucket is
  keyed on a SHA-256 prefix of the bearer, never the bearer. With one pilot token the whole
  panel shares that bucket.
- **Semantic dedup.** The same panelist, cell, price and currency within ten minutes of
  `observedAt` is one observation: later views are counted in `duplicates` and not stored, so a
  resend of a dropped view is a duplicate again (stable across retries). `duplicates` is id
  repeats plus repeat views; the client does not need to tell them apart.
- **Abuse guard.** After storing, each (panelist, cell) in the batch is judged against the
  cell's last 72 h: when at least three other, unflagged panelists observed the cell and every
  one of this panelist's prices there is below 0.5 x their min or above 1.5 x their max, the
  panelist is flagged `suspect` in `panelist_flags` and a `panelist_flagged` line is logged.
  Rows stay stored. `GET /v1/cells` leaves a suspect's rows out of the ladder (logged as
  `suspects_excluded`) until a human clears the flag; `docs/data-retention.md` has the SQL.
- **Deletion and retention.** `DELETE /v1/panelists/:id` above. A daily cron
  (`wrangler.toml`, `src/retention.ts`) deletes raw rows 90 days after receipt, flags after
  90 days, rate windows after 2 hours. Policy: `docs/data-retention.md`.

Tables (`migrations/0002_ingest_hardening.sql`): an index on `(panelist_id, observed_at)`,
`rate_buckets (bucket_key, window_start, count)`, `panelist_flags (panelist_id, status,
reason, cell_key, flagged_at, reviewed_at, review_note)`.

## The cell query

`GET /v1/cells/:cellKey` reads the last 72 h of the cell, collapses the rows to **one vote per
panelist** (their latest observation), runs `resolve()` from `@pennypincher/stats` over those
votes, and answers:

```jsonc
{
  "cellKey": "instacart|10769|2748189|delivery|085",
  "resolution": { "status": "RESOLVED", "tiers": [...], "floor": 199, "confidence": 0.95, "n": 50, ... },
  "n": 50,                 // votes the resolver saw; equals resolution.n
  "panelists": 50,         // distinct panelists in the window
  "observations": 132,     // rows in the window before the collapse
  "latestObservedAt": "2026-09-07T11:58:00.000Z",   // null when there is no data
  "updatedAt": "2026-09-07T12:00:00.000Z",          // when this answer was computed
  "summary": "3 prices in the last 3 days across 50 observations: ...",  // explain(resolution)
  "windowHours": 72
}
```

`resolution.status` is `RESOLVED` or `UNRESOLVED` (with `reason` and `needed`); a cell nobody
has observed is `UNRESOLVED / no_observations` with every count at 0, which is the client's
"no data" state.

Why one vote per panelist: retailers hash-assign a shopper to a tier and keep them there, so a
panelist who checks the same product five times has reported the same tier five times, not
sampled the ladder five times. S10 measured the cost of counting those repeats (wrong-tier
rate above threshold from 0.5% i.i.d. to 8.8% at stickiness 0.9 over 10 observers). The
resolver reads nothing about who observed what; this endpoint owns the dedupe. `observations`
minus `n` is how many repeats were folded.

Caching: the Worker puts the 200 into `caches.default` keyed on the URL with
`Cache-Control: public, max-age=60`. The bearer is checked before the cache lookup, so an
unauthenticated request never sees a cached answer.

```bash
pnpm --filter api dev    # applies migrations to a local D1, then wrangler dev
pnpm --filter api test   # Vitest against the in-memory repo; no network
```

Layout: `src/app.ts` builds the Hono app from a repo factory; `src/routes/cells.ts` is the cell
query (dedupe, resolve, cache); `src/repo/observations.ts` is the repo interface plus row
flattening and `cellKey`; `src/repo/d1.ts` and `src/repo/memory.ts` implement it;
`migrations/` holds the D1 schema.
