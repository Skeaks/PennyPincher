---
id: S11
title: Query API + ladder popup
role: ingest, capture
depends_on: [S07, S09]
owns:
  - docs/sessions/S11.outcome.md
  - apps/api/src/routes/cells.ts
  - apps/api/test/cells.test.ts
  - apps/extension/src/popup/**
  - apps/extension/src/sync/**
  - apps/extension/test/**
---

## Context

Close the loop: the extension uploads observations, asks for the cell's ladder, and shows it.
**Two PRs, in this order, and the second waits.** PR 1 is the API half and can start as soon
as S09 is on `main`. PR 2 is the extension half and must branch from `main` *after* S17
(PR #26) has merged: S17 rewrites `src/popup/model.ts`, `src/popup/render.ts` and
`test/probe/popup.test.ts`, which this session also owns. Build the ladder view on S17's popup
model rather than replacing it.

## Acceptance

API:
- `GET /v1/cells/:cellKey` runs `resolve()` on the last 72 h of that cell and returns the
  `Resolution` plus `n`, `panelists` (distinct observers) and `updatedAt`. Cached 60 s at
  the edge.
- **One vote per panelist per cell.** Before calling `resolve()`, collapse the window's rows
  to one observation per `panelistId` (the latest). S10 measured why: with hash-stable
  assignment a repeat observer re-reports the same tier, so raw N overstates the evidence and
  the wrong-tier rate above threshold went from 0.5% i.i.d. to 8.8% at stickiness 0.9. The
  resolver itself stays unchanged; the endpoint owns the dedupe. Test with synth
  `stickiness: 1` over 10 observers and 200 draws: `n` reported is 10, not 200, and the
  result is `UNRESOLVED` with `insufficient_n`.
- Bearer token required on both endpoints (the S08 pilot token).

Extension:
- `sync/`: every 15 minutes (`chrome.alarms`) upload unsent local observations in batches of
  200 to `POST /v1/observations`; mark sent; retry with backoff; never block capture. Off until
  consent. API base URL and token from build-time env, committed as staging by default.
- Popup shows for the current product: the ladder (each tier as a bar with its share, the
  user's tier highlighted, the floor marked), the `explain()` line with N, and one of three
  states: `RESOLVED`, `UNRESOLVED` (with "needs N more observations"), `NO DATA`. Plus the
  lever-probe line from S06 and "You contributed N observations this week".
- Copy contains none of: save, saving, cheapest, lowest price, guarantee.
- Tests: sync batching and retry with a fake fetch; popup renders all three states from fixtures.

## Out of scope

- Design polish. Functional and legible is enough; a design pass is its own session.
- Web app. There is none.
