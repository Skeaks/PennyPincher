# Company Work Plan: Price Transparency Platform
## Building with Claude Code Agents as the Engineering Org

**Version:** 1.0
**Target:** Public beta in 10 weeks
**Working name:** FLOOR

---

## 0. How to read this document

This is an operating plan for a company whose engineering staff are Claude Code agents. It defines:

1. **The org** — who the agents are, what each owns, and what they're forbidden from touching
2. **The merge gate** — the CI/CD contract every agent must pass before code reaches `main`
3. **The build sequence** — 10 one-week sprints, with each sprint decomposed into discrete Claude Code runs
4. **The human's job** — the small set of decisions and approvals that cannot be delegated

The unit of work is the **run**: one Claude Code session, one branch, one PR, one merge. Runs are sized to fit comfortably inside a single context window with room to spare. A run that needs compaction to finish was scoped wrong.

### Honest note on the timeline

The 30-month phasing in the research document was long because of three separate constraints that got bundled together. Only one of them is engineering:

| Constraint | Compressible by agents? |
|---|---|
| Writing the software | **Yes.** 10 weeks is realistic. |
| Legal review of capture posture | **No.** Calendar-bound. Runs in parallel starting week 0, gates specific merges. |
| Panel density (30–40 observers per SKU-store-time cell) | **No.** Market constraint. Recruiting starts week 1 and runs continuously. |

This plan ships the *product* in 10 weeks. Reaching statistically valid ladder resolution nationwide takes as long as it takes to recruit panelists. The plan is structured so the product is ready and instrumented the moment density arrives, and so it degrades gracefully (showing "insufficient observations" rather than a wrong floor) until then.

---

## 1. The organization

### 1.1 Org chart

```
                    YOU (Founder / CODEOWNER)
                            │
                  ┌─────────┴─────────┐
                  │  ORCHESTRATOR     │  ← decomposes sprints into run briefs
                  └─────────┬─────────┘
                            │
   ┌──────────┬─────────────┼─────────────┬──────────┐
   │          │             │             │          │
PLATFORM   CAPTURE       INGEST         STATS       WEB
 AGENT      AGENT         AGENT         AGENT      AGENT
   │          │             │             │          │
   └──────────┴──────┬──────┴─────────────┴──────────┘
                     │
            ┌────────┴────────┐
         REVIEWER          COMPLIANCE
          AGENT              AGENT
```

### 1.2 Role definitions

Each agent gets a scoped `CLAUDE.md` at the root of its owned directory. Agents read the repo-root `CLAUDE.md` plus their own.

| Agent | Owns (write access) | Never touches | Primary output |
|---|---|---|---|
| **Orchestrator** | `/docs/runs/**` | All source | Run briefs; sprint decomposition |
| **Platform** | `/.github/**`, `/infra/**`, root configs | `/apps/**`, `/packages/**` | CI, deploy, env, observability |
| **Schema** | `/packages/schema/**` | Everything else | The observation contract (frozen after Sprint 0) |
| **Capture** | `/apps/extension/**` | Backend, web | MV3 extension, passive DOM capture |
| **Ingest** | `/apps/api/**`, `/packages/normalize/**` | Extension, web | Ingest endpoint, storage, product identity |
| **Stats** | `/packages/stats/**` | Everything else | Ladder resolution, confidence, test-window detection |
| **Web** | `/apps/web/**` | Backend, extension | Next.js app, ladder UI |
| **Reviewer** | Nothing (read + PR comments only) | All writes | PR reviews; approves others' work |
| **Compliance** | `/docs/compliance/**`, `/apps/web/src/copy/**` (drafts only) | All source | Privacy policy, consent flows, claims copy drafts |

### 1.3 The three org rules that make this work

**Rule 1 — One agent, one directory, one worktree.** Parallel agents that share files will produce merge conflicts faster than you can resolve them. Each agent runs in its own `git worktree`, rooted at its owned path. Cross-boundary changes go through the Orchestrator, which either re-scopes the run or sequences two runs.

```bash
git worktree add ../floor-capture   feat/capture
git worktree add ../floor-stats     feat/stats
git worktree add ../floor-web       feat/web
```

**Rule 2 — No agent approves its own work.** The Reviewer Agent runs in a fresh session with no memory of the implementation reasoning. It sees only the diff, the run brief, and the acceptance criteria. This is not ceremony: an agent that just spent 40 turns rationalizing a design choice is the worst possible reviewer of that choice.

**Rule 3 — The gate is not editable by the workers.** Covered in full below. This is the single most important control in the plan.

---

## 2. The merge gate

Everything an agent produces enters `main` through one door. The door has three tiers: repo settings the agents cannot reach, automated checks that run on every PR, and human approvals on named paths.

### 2.1 Tier 0 — Repository settings (configured once, by you, in the GitHub UI)

Agents have no GitHub admin token. These settings are outside their reach by construction.

**Branch protection on `main`:**
- Require a pull request before merging
- Require 1 approving review; dismiss stale approvals on new commits
- Require review from CODEOWNERS
- Require conversation resolution before merging
- Require linear history (squash merge only)
- Require signed commits
- Block force pushes; block deletion
- **Do not** allow bypass for administrators during the build (turn it off only for genuine incidents, and log why)

**Required status checks:** every job in §2.2 must be green. GitHub will not offer the merge button otherwise.

**Token scope:** the agent's GitHub token has `contents:write`, `pull_requests:write`, `checks:read`. It does **not** have `administration:write` or `workflows:write`. An agent physically cannot alter branch protection or push a workflow file.

### 2.2 Tier 1 — Automated checks (`.github/workflows/gate.yml`)

Ordered roughly by how fast they fail. Cheap checks first so agents get quick feedback.

| # | Check | Fails when | Why it exists |
|---|---|---|---|
| 1 | `no-escape-hatches` | Diff adds `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`, `xit(`, `xdescribe(` | The single most common way an agent "makes tests pass" |
| 2 | `boundary-guard` | PR touches `/.github/**` **and** any of `/apps/**`, `/packages/**` | An agent must never modify its own gate in the same PR as the code being gated |
| 3 | `ownership-guard` | PR touches paths outside the run brief's declared `owns:` list | Enforces Rule 1; catches scope creep early |
| 4 | `lint` + `format` | Biome/ESLint/Prettier violations | Baseline |
| 5 | `typecheck` | `tsc --noEmit` fails in any package | Baseline |
| 6 | `test` | Unit + integration failures | Baseline |
| 7 | `coverage-ratchet` | Line coverage drops below `.coverage-baseline` | Coverage can go up, never down. Baseline file is CODEOWNER-locked. |
| 8 | `mutation` | Stryker score < 60% on `/packages/stats` and `/packages/normalize` | Coverage says lines *ran*; mutation says assertions *matter*. Scoped to the two packages where wrong math is silently expensive. |
| 9 | `fixture-guard` | Diff modifies `**/__golden__/**` without the `fixtures-reviewed` label | Golden fixtures are the ground truth. An agent that can edit them can make anything pass. Label is human-applied only. |
| 10 | `schema-guard` | `/packages/schema` changes without a version bump + `/docs/migrations/` entry | Schema changes invalidate collected observations. Highest-cost mistake in the system. |
| 11 | `forbidden-api` | Diff references credential storage, `chrome.cookies` writes, `password`/`passwd` fields, retailer auth endpoints, `eval`, `Function(` | The client-side-only, no-credentials architecture is a **legal** constraint. Enforce it in CI, not in a doc nobody rereads. |
| 12 | `claims-guard` | Diff touches `/apps/web/src/copy/**` or adds user-facing strings matching `/sav(e\|ing)\|cheapest\|lowest price\|guarantee/i` without the `claims-reviewed` label | FTC/NAD exposure. See §5.3. |
| 13 | `secret-scan` | gitleaks finds a credential | Baseline |
| 14 | `deps-audit` | `npm audit` high or critical | Baseline |
| 15 | `sast` | CodeQL alert introduced | Baseline |
| 16 | `bundle-budget` | Extension bundle > 2MB, or web route JS > 250KB | MV3 review friction; mobile panelists on slow connections |
| 17 | `pr-hygiene` | PR body missing the run-brief ID, acceptance criteria, or the self-attestation checklist | Makes the audit trail machine-readable |

Checks 1, 2, 3, 9, 10, 11, and 12 are the ones that specifically exist because the author is an agent. The rest you'd want anyway.

### 2.3 Tier 2 — CODEOWNERS

```
# /.github/CODEOWNERS

*                                   @reviewer-agent
/packages/schema/**                 @you
/apps/extension/src/capture/**      @you
/apps/web/src/copy/**               @you
/infra/**                           @you
/.github/**                         @you
/docs/compliance/**                 @you
.coverage-baseline                  @you
**/__golden__/**                    @you
```

The four human-locked paths map exactly to the four ways this project can go badly wrong: a broken data contract, a legally exposed capture mechanism, an unsubstantiated savings claim, and a compromised gate.

### 2.4 Tier 3 — Post-merge

- Merge to `main` → auto-deploy to staging
- Nightly: full E2E against **recorded** retailer fixtures (never live sites in CI — rate limits, flakiness, and ToS)
- Weekly: dependency-update PR, reviewed like any other
- Every merge emits a build provenance record to `/docs/audit/` — which agent, which brief, which checks

### 2.5 The anti-gaming clauses in root `CLAUDE.md`

These go in the repo-root `CLAUDE.md` verbatim. They're the behavioral half of the gate.

```markdown
## Non-negotiable rules

1. NEVER modify a test to make it pass. If a test fails, either fix the
   implementation or stop and report the blocker in the PR body.
2. NEVER add @ts-ignore, eslint-disable, .skip, or .only. CI rejects them.
3. NEVER modify files under __golden__/ or .coverage-baseline. These are
   human-owned ground truth.
4. NEVER modify anything under .github/. You do not have permission and
   the attempt will fail the boundary-guard check.
5. NEVER write code that stores, transmits, or requests a user's retailer
   credentials. This is a legal constraint, not a preference.
6. If you cannot complete the run's acceptance criteria, open the PR as a
   DRAFT with a written explanation. A partial, honest PR is worth more
   than a complete one that games a check.
7. Stay inside the paths listed in your run brief's `owns:` field.
```

Rule 6 matters more than it looks. Without an explicit sanctioned failure mode, an agent under pressure to "finish" will find a way to finish.

---

## 3. Architecture

Monorepo, pnpm workspaces, TypeScript throughout.

```
floor/
├── apps/
│   ├── extension/          # MV3, passive capture          [CAPTURE]
│   ├── api/                # Hono on Cloudflare Workers    [INGEST]
│   └── web/                # Next.js, ladder UI            [WEB]
├── packages/
│   ├── schema/             # Zod contracts — THE KEYSTONE  [SCHEMA]
│   ├── normalize/          # UPC / product identity        [INGEST]
│   ├── stats/              # ladder resolution             [STATS]
│   └── synth/              # synthetic ladder generator    [STATS]
├── infra/                  # IaC, migrations               [PLATFORM]
├── docs/
│   ├── runs/               # run briefs + outcomes         [ORCHESTRATOR]
│   ├── compliance/         # privacy, consent, legal pack  [COMPLIANCE]
│   ├── migrations/         # schema change log
│   └── audit/              # build provenance
└── .github/                # the gate                      [PLATFORM]
```

### Three architectural decisions that drive the whole sequence

**The observation schema is the keystone.** Every other package depends on it, and changing it after data collection begins invalidates everything already collected. It gets built and frozen in Sprint 0, before any feature work. `schema-guard` makes changing it deliberately painful.

**Capture is client-side and passive, always.** The extension reads prices the user's browser already rendered. It never logs in, never stores credentials, never automates navigation. This is what keeps the project on the safe side of the *hiQ* / *Van Buren* / *Meta v. Bright Data* line, and it's enforced by `forbidden-api` rather than by good intentions.

**Synthetic data unblocks everything.** The stats engine and UI need realistic price ladders to be built against, and real panel data won't exist until Sprint 5. `packages/synth` generates ladders with known ground truth — configurable tier counts, tier probabilities, and a plantable floor at a known rarity. This lets Stats, Web, and Ingest run fully in parallel from week 1, and it gives the stats engine something coverage can't: tests where the correct answer is known by construction.

---

## 4. The build sequence

Ten one-week sprints. Each sprint lists its runs. A run is one Claude Code session → one PR.

### Sprint 0 — Foundation (Week 0)

**Goal:** the gate works and rejects bad PRs before any feature code exists.

| Run | Agent | Deliverable |
|---|---|---|
| 0.1 | Platform | Monorepo skeleton, pnpm workspaces, TS config, Biome |
| 0.2 | Platform | `gate.yml` with all 17 checks; CODEOWNERS; PR template |
| 0.3 | **You** | Branch protection, token scopes, required checks (GitHub UI) |
| 0.4 | Platform | **Gate self-test:** four deliberately bad PRs that must each be rejected — one adding `.skip`, one editing a workflow alongside source, one editing a golden fixture, one adding a credential field |
| 0.5 | Schema | Observation schema v1.0.0 + migration doc |
| 0.6 | Platform | Staging deploy pipeline, error tracking |

**Exit criteria:** Run 0.4's four bad PRs are all blocked, with evidence in `/docs/audit/`. Do not start Sprint 1 until this is true. A gate you haven't tried to break is a gate you don't have.

**Parallel human track starts now:** engage counsel on capture posture, data-broker status, and the AG-complaint feature. Book it week 0 — it's the longest calendar item in the project.

### Sprint 1 — Capture spike + synthetic data (Week 1)

| Run | Agent | Deliverable |
|---|---|---|
| 1.1 | Capture | MV3 skeleton, consent-gated activation, options page |
| 1.2 | Capture | Capture adapter interface + first adapter (Instacart), against recorded fixtures only |
| 1.3 | Stats | `packages/synth` — ladder generator with known ground truth |
| 1.4 | Ingest | Ingest endpoint, schema validation, write path |
| 1.5 | Compliance | Consent flow copy + privacy policy draft → your review |

**Parallel human track:** panel recruiting begins. Warm intros to Consumer Reports / Groundwork / More Perfect Union volunteer communities.

### Sprint 2 — Ingest hardening + identity (Week 2)

| Run | Agent | Deliverable |
|---|---|---|
| 2.1 | Ingest | Product identity resolution (UPC + fuzzy match), golden fixture set |
| 2.2 | Ingest | Dedup, rate limiting, abuse detection on ingest |
| 2.3 | Capture | Adapters 2–3 (Target, Walmart) |
| 2.4 | Platform | Observability: ingest volume, per-adapter capture success rate |

### Sprint 3 — Stats engine (Week 3)

The mathematical core. Highest mutation-testing bar in the repo.

| Run | Agent | Deliverable |
|---|---|---|
| 3.1 | Stats | Tier resolution: given N observations, infer the discrete price set |
| 3.2 | Stats | Confidence model — coupon-collector bounds; `k·H_k` for full resolution, `~3/p` for floor detection at rarity `p` |
| 3.3 | Stats | **Insufficient-data state.** Must return `UNRESOLVED` rather than guess. Tested against synth data at deliberately inadequate N. |
| 3.4 | Stats | Test-window detection (change-point detection on the observation time series) |

**Run 3.3 is the integrity-critical run of the project.** A tool that confidently shows a wrong floor is worse than no tool. Give it its own PR and review it yourself despite the CODEOWNERS default.

### Sprint 4 — Ladder UI (Week 4)

| Run | Agent | Deliverable |
|---|---|---|
| 4.1 | Web | App shell, auth, panelist onboarding |
| 4.2 | Web | **The ladder component** — distribution, floor, "you are on rung 4 of 5" |
| 4.3 | Web | `UNRESOLVED` and low-confidence UI states |
| 4.4 | Web | Contribution loop: "you contributed N observations this week" |

Have the Web Agent read `/mnt/skills/public/frontend-design/SKILL.md` before run 4.2.

### Sprint 5 — Closed pilot (Week 5)

**First real data.** Everything before this ran on synthetic ladders.

| Run | Agent | Deliverable |
|---|---|---|
| 5.1 | Platform | Production infra, backups, incident runbook |
| 5.2 | Capture | Extension packaging, Chrome Web Store submission |
| 5.3 | Ingest | Live-data reconciliation — do real distributions match synth assumptions? |
| 5.4 | Stats | Recalibrate confidence model against observed reality |

**Gate to Sprint 6:** counsel has signed off on the capture posture. If not, Sprints 6–7 proceed and the pilot waits. Do not ship capture to real users on an unreviewed legal posture.

### Sprint 6 — Basket optimizer (Week 6)

| Run | Agent | Deliverable |
|---|---|---|
| 6.1 | Stats | Multi-retailer assignment: minimize total incl. fees, minimums, memberships |
| 6.2 | Web | Basket builder + optimizer results |
| 6.3 | Ingest | Fee/threshold model per retailer |

### Sprint 7 — Savings measurement (Week 7)

The credibility layer. Read §5.3 before starting.

| Run | Agent | Deliverable |
|---|---|---|
| 7.1 | Stats | Counterfactual engine: observed floor vs. price paid, with confidence intervals |
| 7.2 | Stats | Holdout-group infrastructure for incrementality |
| 7.3 | Web | Savings receipt — shows the interval, never a bare point estimate |
| 7.4 | Compliance | Claims substantiation memo → your review → `claims-reviewed` label |

### Sprint 8 — Compliance detection (Week 8)

| Run | Agent | Deliverable |
|---|---|---|
| 8.1 | Stats | Variance-without-disclosure detector (NY Algorithmic Pricing Disclosure Act) |
| 8.2 | Web | Evidence packager — user-submitted, form-filling only, no legal advice |
| 8.3 | Compliance | UPL guardrails + disclaimers → counsel review |

**Do not ship 8.2 without counsel sign-off.** The DoNotPay FTC order ($193K, plus consumer notification) is the precedent. Frame strictly as a self-help form-filler the user submits themselves.

### Sprint 9 — Hardening (Week 9)

| Run | Agent | Deliverable |
|---|---|---|
| 9.1 | Platform | Load testing, cost modeling at 25K panelists |
| 9.2 | Capture | Adapter resilience — graceful degradation when DOM changes |
| 9.3 | All | Bug burndown from pilot |
| 9.4 | Compliance | Data-broker registration assessment; DSAR/deletion flows |

### Sprint 10 — Beta (Week 10)

| Run | Agent | Deliverable |
|---|---|---|
| 10.1 | Web | Public landing, waitlist, press kit |
| 10.2 | Platform | Scale-out, monitoring, on-call |
| 10.3 | **You** | Launch coordination with CR/Groundwork/press |

---

## 5. Operating procedures

### 5.1 The run brief

Every run starts from a brief the Orchestrator writes to `/docs/runs/`. This is the agent's job description and the Reviewer's rubric.

```yaml
id: 3.3
sprint: 3
agent: stats
title: Insufficient-data state returns UNRESOLVED

owns:
  - packages/stats/src/resolve/**
  - packages/stats/test/resolve/**

context: |
  The tier resolver from run 3.1 currently returns a best guess at any N.
  At low N this produces confidently wrong floors, which is the single
  worst failure mode this product has.

acceptance:
  - resolve() returns {status:'UNRESOLVED'} when N is below the
    coupon-collector threshold for the observed tier count
  - Threshold derived from k·H_k, not a hardcoded constant
  - Property test over synth data, 1000 seeds: never reports a floor
    below the true floor at any N
  - Mutation score on the resolve module >= 70%

out_of_scope:
  - UI treatment (run 4.3)
  - Confidence display copy (run 7.3)

human_review_required: true   # despite CODEOWNERS default
```

### 5.2 Run hygiene

- **One run, one PR, one merge.** No stacked branches across sprints.
- **Scope to fit the context window with headroom.** If a run needs compaction to finish, it was scoped wrong — split it and note that in the retro.
- **Every run ends with a retro line** in `/docs/runs/<id>.outcome.md`: what was harder than expected, what the brief got wrong. This is how briefs get better.
- **Failed runs are data, not waste.** A draft PR with an honest blocker is a successful run.
- **Never run agents with permission checks disabled on anything that can reach `main`.** Sandbox freely on throwaway worktrees; never on the path to production.

### 5.3 The claims discipline

Anything in the product that says a user saved money is a regulated claim. The research established the precedent trail: Honey's "every working code on the internet" was discontinued after a BBB National Programs NAD challenge; DoNotPay's "robot lawyer" drew a $193K FTC order.

Standing rules:
- No "up to X%" claims. Ever.
- No cumulative face-value totals ("we've saved users $X million") — that's the misleading incumbent pattern.
- Every savings figure is an interval derived from observed panel data, with the N disclosed.
- Every affiliate relationship disclosed at the point of ranking, and ranking is never commission-weighted.
- The `claims-guard` check plus the `claims-reviewed` label make this structural rather than aspirational.

### 5.4 What only you can do

| Cadence | Task |
|---|---|
| Once, Sprint 0 | Branch protection, tokens, required checks |
| Once, Sprint 0 | Verify the gate rejects all four bad PRs |
| Weekly | Approve CODEOWNER-locked paths (schema, capture, copy, infra) |
| Weekly | Read run retros; re-scope the next sprint's briefs |
| Gated | Apply `fixtures-reviewed` and `claims-reviewed` labels |
| Continuous | Legal engagement; panel recruiting; press relationships |

Everything else is delegable.

---

## 6. Risks specific to this construction

| Risk | Mitigation |
|---|---|
| Agent games a check to "finish" | `no-escape-hatches`, `fixture-guard`, mutation testing, sanctioned draft-PR failure mode |
| Agent edits the gate | `boundary-guard` + token scoped without `workflows:write` |
| Parallel agents collide | Worktree isolation + `ownership-guard` + per-agent path ownership |
| Schema churn invalidates collected data | `schema-guard`, freeze after Sprint 0, human CODEOWNER |
| Confidently wrong floor shown to users | Run 3.3 as a dedicated integrity run; `UNRESOLVED` as a first-class state |
| Legal posture drifts as code evolves | `forbidden-api` check encodes the constraint in CI |
| Retailers stop running price experiments | Monitor continuously; the pivot is from "detect variance" to "certify one-price integrity" |
| Panel density never reaches threshold | Product degrades to `UNRESOLVED` honestly; concentrate depth on few SKUs rather than breadth |

The last two are business risks the build plan can't solve — they're in here so they stay visible.

---

## 7. Immediate next step

Sprint 0, runs 0.1 through 0.4, in order. Do not start feature work until run 0.4 proves the gate rejects all four bad PRs.

When you're ready, we take this sprint by sprint and write the individual run briefs — each one becomes a Claude Code session.
