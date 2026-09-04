# Sessions

One session = one Claude Code run = one branch = one PR. Each brief lists the paths it owns,
what "done" means, and what is out of scope. Do them in order; the order is the dependency
graph. Reviewing is its own session type: `REVIEW.md`.

Start a session by pasting: *"Read CLAUDE.md, CONTRIBUTING.md, then docs/sessions/S05-....md
and do that session."*

## Phase 1: foundation to closed pilot

| Id | Title | Role | Depends on | Ships |
|---|---|---|---|---|
| S00 | Foundation | Platform | | This repo: gate, schema 0.1.0, docs. **Done 2026-09-04.** |
| [S01](S01-gate-self-test.md) | Gate self-test + nightly skeleton | Platform | S00 | Four bad PRs rejected (`docs/audit/S01-gate-self-test.md`); `nightly.yml`. **Done 2026-09-04.** |
| [S02](S02-fixture-recorder.md) | Fixture recorder + first snapshots | Capture | S00 | `tools/scrub`, 12 scrubbed Instacart/Target/Walmart pages in `fixtures/`. **Done 2026-09-04.** |
| [S03](S03-schema-v1-and-synth.md) | Schema 1.0.0 + synthetic ladders | Schema, Stats | S02 | Schema 1.0.0 revised against real pages; `packages/synth`. **Done 2026-09-04.** |
| [S04](S04-extension-skeleton.md) | Extension skeleton + consent | Capture | S00 | WXT MV3 app, consent gate, options page, local store, no network. **Done 2026-09-04.** |
| [S05](S05-instacart-adapter.md) | Adapter interface + Instacart adapter | Capture | S02, S03, S04 | Passive capture producing valid observations, tested on fixtures. **Done 2026-09-04.** |
| [S06](S06-lever-probe.md) | Lever probe v1 | Capture | S05 | "Your price vs anonymous price" in the popup. **Decision data starts here.** |
| [S07](S07-api-ingest.md) | Ingest API | Ingest | S03 | Hono Worker + D1, validation, idempotency, PII guard. **Done 2026-09-04.** |
| [S08](S08-deploy-loop.md) | Deploy loop | Platform | S07 | `deploy.yml`, staging + prod, rollback; the 1 to 5 minute number measured |
| [S09](S09-stats-resolve.md) | Tier resolution + confidence + UNRESOLVED | Stats | S03 | `packages/stats` core, tested on synth ground truth |
| [S10](S10-stats-hardening.md) | Stats hardening | Stats | S09 | Property tests, nightly mutation score, change-point stub |
| [S11](S11-query-api-and-ladder-ui.md) | Query API + ladder popup | Ingest, Capture | S07, S09 | Cell query endpoint; ladder + UNRESOLVED + contribution counter in popup |
| [S12](S12-adapters-target-walmart.md) | Adapters 2 and 3 + health beacon | Capture | S05 | Target, Walmart adapters; per-adapter parse success telemetry |
| [S13](S13-product-identity.md) | Product identity | Ingest | S07 | `packages/normalize`: UPC + fuzzy; golden fixtures |
| [S14](S14-ingest-hardening.md) | Ingest hardening + deletion | Ingest | S07 | Dedup, rate limits, panelist rotation, delete-my-data endpoint |
| [S15](S15-pilot-pack.md) | Pilot pack | Compliance, Web | S06, S11, S14 | Privacy policy, consent copy, unlisted Web Store build, static landing + waitlist |
| [S16](S16-closed-pilot.md) | Closed pilot + variance gate | All | S15 | 30 to 60 panelists, one metro, one retailer; go / pivot decision |

## Phase 2 (briefs written after S16's decision)

- Basket optimizer: multi-retailer assignment including fees, minimums, memberships.
- Savings receipt: observed floor vs price paid, as an interval with N. Never a point estimate.
- Variance-without-disclosure detector (NY Algorithmic Pricing Disclosure Act).
- Evidence packager: user-submitted, form-filling only, counsel-reviewed.
- Data-licensing export for researchers and press.
- Or, if S16 says no variance: "one-price certified" B2B product and the lever-probe
  subscription. See `docs/CRITIQUE.md` §3 and §6.

## Human track (runs alongside, not a session)

- Now: create the `claims-reviewed` and `fixtures-reviewed` labels in GitHub.
- Before S02: record raw pages (S02 explains how; agents cannot browse retailers for you).
- Before S15: choose the pilot metro and retailer; line up 30 to 60 panelists.
- Before S16 exit: counsel review of `docs/decisions/0003-capture-posture.md`.
