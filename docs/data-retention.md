# Data retention

What PennyPincher's server stores, for how long, and how a panelist gets it deleted. Written
in S14; the mechanisms live in `apps/api` (see its README) and `apps/extension/src/identity/`.
The consent copy (`apps/extension/src/lib/copy.ts`, consent version 5) says the same in plain
language; if the two ever disagree, fix both in one PR.

## What is stored

One row per price observation, in D1 (`observations`, migration 0001). Every field is in the
observation schema (`packages/schema`) and was validated against its PII guard at the trust
boundary: the price shown, the product's retailer item number and title, retailer and store,
fulfilment, ZIP3, device class, adapter and extension version, an evidence hash, and the
panelist's **rotating pseudonymous id**. No name, email, IP address, user-agent, full ZIP, or
anything from the retailer session. The server never sees the user's browser beyond the API's
own request, and the API logs no request bodies.

Three small tables around it (migration 0002):

| Table | Holds | Keyed by |
|---|---|---|
| `rate_buckets` | a count per hour | a SHA-256 prefix of the bearer, or `panelist:<id>` |
| `panelist_flags` | the abuse guard's log: reason, cell, when, review state | `panelist_id` |
| (none) | the edge cache of `GET /v1/cells` answers, 60 s | the URL |

The panelist id is minted by the extension (`crypto.randomUUID()`), never derived from the
user or the browser, and **replaced every 7 days**. The extension keeps the current id plus
the last three retired ones so it can name them for deletion.

## For how long

| Data | Kept | Then |
|---|---|---|
| Raw observations | **90 days** from receipt (`received_at`) | deleted by the daily retention job |
| Abuse flags | 90 days from the flag | deleted by the same job |
| Rate-limit windows | 2 hours | deleted by the same job |
| Aggregates (price ladders per cell) | **indefinitely**, once they exist | never tied to a panelist id |

The retention job is the Worker's cron trigger (`wrangler.toml`, `[triggers]`, 03:17 UTC
daily; `src/retention.ts`). It is idempotent: it only deletes rows already past the cutoff, so
running it twice, or late, changes nothing.

Aggregates today are computed on read from the raw rows and cached at the edge for 60 s;
nothing aggregate is written to storage yet. When a later session materialises ladders (for
history, or so a cell survives its raw rows expiring), those rows carry counts and prices per
cell and window and no panelist id, and are kept indefinitely. This document must be updated
in that PR.

## How deletion works

`DELETE /v1/panelists/:id` removes every row stored under one panelist id: its observations,
its abuse flag if any, and its rate buckets. It is idempotent (an unknown id is `200` with
`deleted: 0`) and bearer-protected like the other routes. The 60 s edge cache is not purged, so
a ladder the panelist contributed to can show the old answer for up to a minute.

The extension's **"Delete my data"** (options page; `src/identity/delete.ts`):

1. Collects every id this browser has used: the identity record's current and retired ids,
   plus any other id still on a locally stored row.
2. Calls `DELETE /v1/panelists/:id` for each. If any call fails, **nothing is removed, on the
   server or locally**, and the page says so; the user retries when online.
3. Only when every call succeeded: clears the local observations, probe results, sync state
   and the identity record. The next capture mints a fresh id.

Without a pilot token in the build nothing was ever uploaded; the extension clears local state
and says the server was not involved.

Known gap, on purpose: the extension keeps four ids (the brief's number) but the server keeps
raw rows for 90 days (about 13 rotations). An id older than the fourth rotation whose rows
have also been pushed out of the local store (5,000-row FIFO) cannot be named for deletion and
is only covered by the 90-day expiry. Raising `PANELIST_IDS_KEPT` to 13 closes it; that is a
one-constant change and Jamie's call (S14 retro).

Uninstalling the extension deletes everything it stored locally (the browser does that) but
sends nothing to the server; those rows expire at 90 days.

## Reviewing an abuse flag

The guard flags a panelist whose every price in one cell falls outside the range at least
three other panelists observed there, by more than 50% (below 0.5 x min or above 1.5 x max).
Its rows stay stored; `GET /v1/cells` leaves them out of the ladder until a human reviews.
Flags are logged as `panelist_flagged` events (Workers observability) and stored in
`panelist_flags`. To review, from `apps/api/`:

```bash
pnpm exec wrangler d1 execute pennypincher-production --env production --remote --command "SELECT * FROM panelist_flags WHERE reviewed_at IS NULL"
```

Clear a false positive (the panelist's rows count again from the next request; the edge cache
lags up to 60 s):

```bash
pnpm exec wrangler d1 execute pennypincher-production --env production --remote --command "UPDATE panelist_flags SET status = 'cleared', reviewed_at = '2026-09-07T12:00:00Z', review_note = 'store-brand size variant' WHERE panelist_id = '<id>'"
```

Confirm a real one by setting `reviewed_at` and leaving `status = 'suspect'`; its rows stay
excluded and the flag expires with the 90-day purge. Deleting the panelist's rows outright is
`DELETE /v1/panelists/:id`.
