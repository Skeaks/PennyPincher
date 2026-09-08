# Pilot plan (S16)

The closed pilot: one metro, one retailer, the top 200 SKUs by observation count, 30 to 60
panelists, two weeks. Everything before this ran on synthetic ladders. The plan's machine-
readable half is `pilot.json` in this directory; the report tool reads it, so a value changed
here must change there too.

## Metro and retailer

| | Value in `pilot.json` | Status |
|---|---|---|
| Metro | `X` | Placeholder, given as "X" when the session started. Replace before recruiting. |
| Retailer | `Y` | Placeholder, given as "Y". Must become `instacart`, `target` or `walmart`; the tool refuses to run until it does. |

Recommendation, for Jamie to accept or overrule with one edit to `pilot.json`:

- **Retailer: `target`.** It is the only adapter where the lever probe produces comparisons
  today: Target pages carry a store id on both the logged-in and the anonymous side, and S02
  already saw Target move the recorder from Princeton to Durham on sign-in with a different
  banana price. Instacart's anonymous fetch resolves to a location the DOM does not name, so
  its probe answers "Could not check" until the anonymous HTML exposes a location id (S17,
  `compare.ts`), and Instacart paused item price tests in December 2025 after the FTC's civil
  investigative demand (CRITIQUE §3), which makes multi-tier cells there structurally less
  likely. Walmart never renders its store number, so its probe matches on the label only.
  Both retailers still count in the probe table (every retailer's rows are reported), so a
  Target pilot loses nothing there.
- **Metro: the zip3 085 / 086 area (central New Jersey).** Every fixture was recorded there
  and the first panelists come from Jamie's own network, so it is where the density will be.
  Put the zip3 prefixes in `zip3s`; the weekly report counts rows per zip3 so drift out of the
  metro is visible.

## Recruiting source

1. Jamie's personal network first. No counsel review is needed for that group
   (`docs/decisions/0003-capture-posture.md`, status line).
2. The waitlist on the landing page (`apps/web`) once counsel has reviewed ADR 0003. Nobody
   outside the personal network installs before that date; `counselReviewed` in `pilot.json`
   records it and the decision is not final without it.

Each panelist installs the unlisted Chrome Web Store build (`docs/webstore.md`), reads the
consent screen (v6, `docs/compliance/consent.md`) and the privacy policy draft, and gets the
pilot bearer token from Jamie out of band (it is a `.env` value for the build, never in the
repo; S11). The S14 rate limit is 1,000 rows an hour panel-wide on one token; 60 panelists at
15-minute syncs stay under it unless someone browses listing pages continuously, in which case
the sync backs off and nothing is lost.

## The SKU list

Nothing is chosen up front. The brief says "the top 200 SKUs by observation count", and
observation counts only exist once the panel is running, so:

1. Week 0 (before the start): Jamie's own captures since S06 seed the list. Run the `skus`
   command over an export of them to see what is there; it is a sanity check, not the list.
2. End of week 1: `report skus --rows docs/pilot/raw/week-1.rows.json` writes `skus.md`, the
   pilot retailer's top 200 by observations with panelist counts. That file is the list.
3. End of week 2: regenerate over both weeks; the list is what the decision is computed over
   only in the sense that every cell of the pilot retailer is; the tool does not cut to 200.

## Dates

`startDate` is `null` until every precondition below is met; then it is the next Monday, UTC,
and `endDate` is fourteen days later (`weeks: 2`). Reports run on the Monday after each week.

Preconditions, in order:

1. Jamie creates the Pages project and the waitlist database (`docs/deploy.md`), or decides
   the personal-network group does not need the landing page.
2. Jamie submits the unlisted Web Store listing and it is approved (`docs/webstore.md`).
3. `PILOT_TOKEN` is set on the production Worker (`docs/deploy.md`) and in the panelists' build.
4. Metro and retailer are set in `pilot.json` and this file.
5. For anyone outside the personal network: counsel has reviewed ADR 0003.

## Producing a week report

From `apps/api/` (the wrangler config lives there), with `wrangler login` done:

```bash
pnpm --filter @pennypincher/pilot-report report query --week 1
```

prints the two `wrangler d1 execute --remote --json` commands (observations of the week,
abuse flags) and where to write their output: `docs/pilot/raw/`, which is gitignored because
an export carries panelist ids and titles. Then, from anywhere in the repo:

```bash
PILOT_TOKEN=... pnpm --filter @pennypincher/pilot-report report week 1 --rows docs/pilot/raw/week-1.rows.json --flags docs/pilot/raw/week-1.flags.json
```

writes `week-1.md` (commit it) and `week-1.json` (commit it; the decision page is regenerated
from the raw exports, not from these). `--no-api` skips the two API sections when the token is
not to hand. At the end:

```bash
pnpm --filter @pennypincher/pilot-report report skus --rows docs/pilot/raw/week-1.rows.json --rows docs/pilot/raw/week-2.rows.json
pnpm --filter @pennypincher/pilot-report report reconcile --rows docs/pilot/raw/week-1.rows.json --rows docs/pilot/raw/week-2.rows.json --flags docs/pilot/raw/week-2.flags.json
pnpm --filter @pennypincher/pilot-report report decide --rows docs/pilot/raw/week-1.rows.json --rows docs/pilot/raw/week-2.rows.json --flags docs/pilot/raw/week-2.flags.json
```

`tools/pilot-report/README.md` explains every number. The decision rule and its thresholds
are in `decision.md` and `pilot.json`.

## What the reports measure, and one design choice

Cells are resolved the way the API resolves them (one vote per panelist, suspects excluded,
`resolve()` from `packages/stats`) but over the whole week, not the API's 72 hours. At pilot
density a 72 h window rarely reaches the coupon threshold, and the question is whether
variance exists, not what the popup showed on a given afternoon. The API's own 72 h view is
printed next to it so the two can be compared. The lever-probe rate is recomputed from the
uploaded pairs (the extension's verdicts never leave the browser) with the same store rule the
extension uses.

## Data handling

Exports live in `docs/pilot/raw/` (gitignored) and are deleted when the pilot ends; the
server's own 90-day retention (`docs/data-retention.md`) applies regardless. The committed
reports carry counts, cell keys and product titles, never panelist ids.
