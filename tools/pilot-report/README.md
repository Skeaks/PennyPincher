# pilot-report

The S16 closed-pilot reporting tool. Brief: `docs/sessions/S16-closed-pilot.md`; plan and
the decision rule: `docs/pilot/`.

```bash
pnpm --filter @pennypincher/pilot-report report query --week 1        # the export commands
pnpm --filter @pennypincher/pilot-report report week 1 --rows <export.json> [--flags <flags.json>] [--no-api]
pnpm --filter @pennypincher/pilot-report report skus --rows <export.json>... [--top 200]
pnpm --filter @pennypincher/pilot-report report reconcile --rows <export.json>... [--flags <flags.json>]
pnpm --filter @pennypincher/pilot-report report decide --rows <export.json>... [--flags <flags.json>]
pnpm --filter @pennypincher/pilot-report test                          # 74 tests, no network
```

Config is `docs/pilot/pilot.json` (`src/config.ts` is the schema). The bearer for the API is
the `PILOT_TOKEN` environment variable; never a flag, so it never lands in shell history.
Output goes to `docs/pilot/`.

## Where the numbers come from

Two sources, on purpose:

- **The D1 export** (`src/rows.ts`). The API has no listing endpoint, and should not have one:
  nothing serves observations in bulk. `query` prints the exact `wrangler d1 execute --remote
  --json` commands for a week (every flattened column but `raw_json` and `evidence_hash`, plus
  `json_extract(raw_json, '$.context.cleanSession')`, and the `panelist_flags` table). The
  files go to `docs/pilot/raw/`, gitignored. Overlapping exports are folded by
  `observation_id`.
- **The query API** (`src/api.ts`, `src/health.ts`). `GET /v1/cells/:cellKey` for every cell
  the export puts at or above the threshold, `GET /v1/adapter-health` for the adapter table.
  `--no-api` skips both.

## What each section of `week-N.md` means

| Section | Computed how |
|---|---|
| Panel | Distinct `panelist_id`s and rows in the week, all retailers and the pilot retailer; the probe's anonymous rows; by-weight estimates; rows per adapter version, zip3, fulfilment; abuse flags on file. |
| Cells | The pilot retailer's cells resolved over the whole week: one vote per panelist (`onePerPanelist` from `apps/api`, the same function the endpoint uses), suspects excluded, `resolve()` from `packages/stats` with the window as `windowHours`. Threshold is `requiredObservations(2)` = 5 votes. Spread is `(top - floor) / floor` on RESOLVED multi-tier cells. |
| Cells as the API sees them | The same cells asked of the API, whose window is 72 h. At pilot density this will show fewer RESOLVED; the two views are printed side by side rather than reconciled. |
| Lever probe | Every anonymous row (`session_state = logged_out` and `cleanSession = true`) paired with the same panelist's logged-in row for the same retailer + SKU, nearest in time within the hour before it (five minutes of clock slack after). Verdict by the extension's store rule (`src/probe.ts` mirrors `apps/extension/src/probe/compare.ts`): ids when both sides have one; labels otherwise, except Instacart, whose label is a banner. Difference rate = (MORE + LESS) / comparable. The extension's own verdicts never leave the browser, so this is the rate the panel actually contributed. |
| Adapter health | The API's last seven days, dates folded per adapter version, failures by reason. |
| Top SKUs | The pilot retailer's SKUs by rows, then panelists. `skus` writes the full list. |

## `reconcile.md`

Replays each RESOLVED cell's votes in arrival order and asks, for a sweep of
`RESOLVE_SAFETY_FACTOR` (1 to 3) and `MIN_TIER_SIGHTINGS` (2 to 4): at the first prefix where
the resolver would have said RESOLVED, did it have the final tier count and the final floor?
"Final" is `resolve()` over the whole window, so the judge is the real engine; the replay
emulates its two guards without the singleton rule (that starts at N = 100). The rarest-tier
share per tier count is printed against the uniform 1/k synth assumed. The recommendation is
text: keep the constant if the premature-floor rate at 1.5 is inside the 15% budget synth was
tuned to, else the smallest factor in the sweep that holds, else "a panel-size problem". A
constant changes only by a PR to `packages/stats` that quotes the file.

## `decision.md`

The brief's three rules over the whole pilot window, plus two minimums from `pilot.json`
(20 RESOLVED cells, 50 comparable checks) below which the verdict is INCONCLUSIVE. Not final
without `counselReviewed`.

## Tests

`test/e2e.test.ts` drives the real Hono app from `apps/api` on its in-memory repos through
`POST /v1/observations` and reads it back the way production does; the export is what the
repo stored. Everything else is unit tests over synthetic cells from `@pennypincher/synth`.
`test/render.test.ts` scans every rendered page for the rule-10 words.
