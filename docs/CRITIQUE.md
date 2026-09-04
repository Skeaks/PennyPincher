# Critique of the original plan, and what changed

The two source documents are in `docs/plan/`. The research is strong and the work plan is
thoughtful. Both were written as if a funded team with counsel on retainer and parallel agent
fleets were executing them. This project is one founder, one GitHub account, and one Claude Code
session at a time. Below: what I kept, what I cut, what I added, and why.

## 1. The gate was built for a bigger org than exists (technical)

The work plan specifies 17 CI checks, 9 agent roles, per-directory `CLAUDE.md` files, signed
commits, CODEOWNERS enforcement, and a mutation-testing bar on every PR.

Problems:

- **Branch protection and CODEOWNERS enforcement need GitHub Pro on private repos.** Verstill
  hit exactly this wall. Designing controls around a feature that is not turned on is how the
  last project ended up with "PR discipline is convention".
- **Mutation testing and CodeQL on every PR blow the 1 to 5 minute deploy budget.** Stryker on a
  stats package is 5 to 15 minutes. That is the verstill pattern: a serial gate so slow that
  agents start working around it.
- **Nine roles with scoped CLAUDE.md files is coordination overhead with no one to coordinate.**
  Sessions are sequential. Role-per-directory only pays off when agents actually run in parallel
  and collide.

What changed:

- **PR gate: 7 checks, under 2 minutes.** boundary-guard, no-escape-hatches, forbidden-api,
  Biome, tsc, Vitest, gitleaks. Everything slower goes to a nightly job that opens an issue and
  never blocks. See `CONTRIBUTING.md`.
- **The controls that do not need Pro are the real controls:** the boundary-guard step (a PR
  cannot touch `.github/` and app code together), the two guard scripts, and the rules in
  `CLAUDE.md`. CODEOWNERS is kept as documentation of "ask Jamie first".
- **Four roles, not nine:** Builder (any session with a brief), Reviewer (a fresh session with
  `docs/sessions/REVIEW.md`), Orchestrator (writing and re-scoping briefs, which is this
  document's job and then yours), and Jamie (gate changes, schema, fixtures, claims copy).
- **Kept:** Rule 2 (never review your own work), the sanctioned draft-PR failure mode, the
  four human-locked paths, `boundary-guard`, `forbidden-api`, `no-escape-hatches`. Those are the
  cheap, high-leverage parts.

## 2. "Ten one-week sprints" assumed parallelism that does not exist (planning)

The plan runs Capture, Ingest, Stats and Web agents in parallel each week. In practice you run one
session, then the next. So the unit of planning is the session, ordered by dependency, and the
calendar takes care of itself.

What changed: 16 sessions to a closed pilot, each sized to one context window, each with
`owns:` paths, an acceptance list, and an explicit out-of-scope list. Index in
`docs/sessions/README.md`. The order is chosen so that every session ships something runnable
and nothing waits on a session that has not happened.

## 3. The plan defers the biggest business risk to week 5 (business)

The research document's own caveat is the most important sentence in it: Instacart stopped item
price tests in December 2025 after an FTC civil investigative demand. The panel product has
**zero** value under two conditions: (a) retailers are not currently running experiments, or
(b) density is below the coupon-collector threshold. Both are outside your control, and the
original plan does not find out whether (a) holds until Sprint 5.

What changed: two product tracks, with the individual one first.

- **Track A: the lever probe (individual, works at N=1).** The extension checks whether the
  shopper's price differs from the price an anonymous visitor gets for the same item, right now,
  and whether fulfilment path or ZIP move it. This is client-side, uses `fetch` with
  `credentials: "omit"` against a public product page (the logged-off posture the
  *Meta v. Bright Data* line treats most favourably), never automates the logged-in session, and
  delivers value on install day with no other users. It is also closer to your original idea:
  find the levers, counter them.
- **Track B: the panel ladder (collective, needs density).** Unchanged in substance. Track A
  is the recruiting hook that gets Track B its observers: every probe is also an observation.
- **A decision gate at S06 and S16:** does variance exist on the retailers we cover? If Track A
  finds no logged-in/logged-out or ZIP variance and the pilot panel finds no multi-price cells,
  the pivot the research already names ("certify one-price integrity") becomes the product,
  and Track A's lever list is the feature set.

## 4. Freezing the schema before seeing real pages is backwards (technical)

The plan freezes the observation schema in Sprint 0. You cannot know which fields matter until
you have looked at real Instacart, Target and Walmart DOMs.

What changed: `packages/schema` ships now at `0.1.0` as a versioned draft (it is in this repo).
S02 records scrubbed page snapshots. S03 revises the schema against them and tags `1.0.0`. After
that, changes cost a version bump and a migration note. Freezing is a process, not a moment.

## 5. Stack trims (technical)

| Plan | Here | Why |
|---|---|---|
| Next.js web app in Sprint 4 | Static landing on Cloudflare Pages in S15; the ladder UI lives in the extension popup | A logged-in web app is a second product surface with auth, sessions and deploys. The extension already has the user. Add the web app when a non-extension user needs it. |
| Postgres via Cloudflare / unspecified | Cloudflare D1 (SQLite) behind a small repository layer | Zero ops, deploys with the Worker in seconds, free at pilot scale. The repository layer keeps the Postgres migration a single-package change. Trigger to migrate: >50M rows or a query the stats engine cannot express in SQLite. |
| Hono on Workers | Hono on Workers | Kept. It is the right call for the 1 to 5 minute loop. |
| Custom MV3 build | WXT | Kept the MV3 posture, chose the framework with HMR and a sane manifest story. |
| pnpm, TypeScript, Biome, Vitest, Zod | Same | Kept. |

Verstill-specific lessons applied to the deploy loop are tabulated in `CONTRIBUTING.md`. The
short version: declarative deploys that replace the whole artifact, no release script, no tags,
no locks, merge is deploy, `wrangler rollback` is the safety net.

**Honest caveat on the 1 to 5 minute target:** it applies to the API and the site. The extension
goes through Chrome Web Store review (hours to days). The dev loop for the extension is "load
unpacked, reload", which is seconds, and the pilot uses an unlisted Web Store listing so
updates reach panelists without a public launch.

## 6. Business model (business)

- **No affiliate revenue in phase 1, not even "walled off".** The research recommends affiliate as
  bridge financing with ranking isolation. The whole brand is "we are the one that is not
  conflicted". One affiliate link invites the Honey comparison, and the disclosure burden lands
  on every screen. Fund the pilot without it.
- **Data licensing to AGs and researchers is real but slow and small.** Treat it as credibility
  and distribution (press, Consumer Reports, Groundwork), not as a revenue line to plan around.
- **The realistic paid product is a subscription for Track A plus alerts.** "Is my account being
  charged more than a stranger, on every site I shop" is a thing people pay for today (VPNs sell
  it, badly). It does not depend on panel density.
- **The pivot product deserves a name now:** if experiments stop, retailers who *do not*
  personalize will pay to prove it. "One-price certified" is a B2B badge backed by the same
  panel, and it is the only version of this business that gets stronger as regulation bites.
- **Claims discipline is kept verbatim.** No "up to X%", no cumulative totals, intervals with N
  disclosed, `claims-guard` label. It is the cheapest insurance in the plan.

## 7. Legal posture without counsel on day zero (business, technical)

The plan books counsel in week 0. A bootstrapped founder will write code before that meeting
happens. So the architecture has to be defensible on its own, and it is, if three lines hold:

1. The extension only reads what the browser already rendered for the user (passive).
2. Cross-origin probes are logged-out fetches of public product pages, never automation of the
   user's authenticated session, never with credentials.
3. No credentials, cookies or PII ever leave the browser (`packages/schema` enforces the key
   list; `scripts/check-forbidden-api.sh` enforces the code).

Counsel reviews this posture before public beta (S16 exit), not before the first commit.
Decision record: `docs/decisions/0003-capture-posture.md`.

## 8. Things the plan was missing

- **Deletion from day one.** A panelist must be able to purge their observations. It is a
  20-line endpoint when the table is small and a project when it is not (S14).
- **Depth over breadth, concretely.** One metro, one retailer, the top 200 SKUs by velocity.
  The research says this; the plan's sprint list does not. S16 pins it.
- **Adapter health telemetry.** DOM changes silently break capture. Each adapter reports
  parse success rate so a broken adapter is a dashboard number, not a support ticket (S12).
- **A recruiting story that is not "warm intros".** Track A is it: install for yourself, and the
  panel gets an observer.

## 9. What I did not change

The core insight is right and it is the whole company: bucket assignment is hash-stable per
user, so an individual cannot sample the distribution but a panel can, and the coupon-collector
math tells you exactly how many observers you need. Synthetic ladders with known ground truth as
the test oracle for the stats engine is the best single engineering idea in the plan. `UNRESOLVED`
as a first-class state is the best single product idea. All three are load-bearing here.
