# web

The landing page and pilot waitlist (S15). Static HTML in `public/` on Cloudflare Pages, plus
one Pages Function, `functions/api/waitlist.ts`, which is the form's target and the one place
in PennyPincher that stores an email address. No framework, no build step: what is in
`public/` is what is served.

| Path | What |
|---|---|
| `public/index.html` | The landing page: the panel, the lever probe, `UNRESOLVED`, what the extension never does, the waitlist form |
| `public/joined.html` | Where the form lands |
| `functions/api/waitlist.ts` | `POST /api/waitlist`: reads the form, stores email + time in D1, answers `303` |
| `src/waitlist.ts` | The pure part: validation, honeypot, the redirect for each outcome. Tested |
| `migrations/0001_waitlist.sql` | The `waitlist (email PRIMARY KEY, joined_at)` table |
| `wrangler.toml` | Pages project name, output dir, the `WAITLIST_DB` D1 binding |

## Privacy

The function reads two form fields, `email` and the honeypot `website`, stores the normalised
email and the time, and nothing else: no IP, no user-agent, no referrer, no log line. A
second submission of the same address is a no-op, so the response never reveals whether an
address is already on the list. A filled honeypot stores nothing and lands on the same page as
a real join. Policy line: `docs/compliance/privacy-policy.md`, "The waitlist".

Copy rule: `test/copy.test.ts` fails if any page under `public/` contains a regulated claim
word (CLAUDE.md rule 10) without a `<!-- claims-reviewed -->` comment on the line before it.

## Run

```bash
pnpm --filter web test        # Vitest on src/ and the shipped HTML; no network
pnpm --filter web typecheck
pnpm --filter web dev         # local D1 under .wrangler/, then wrangler pages dev on :8788
```

## Deploy

Merge is deploy (`deploy.yml`, the `pages` job, S15): `wrangler d1 migrations apply
WAITLIST_DB --remote`, then `wrangler pages deploy public --project-name pennypincher-web`.
Before the first deploy Jamie creates the Pages project and the D1 database once and puts the
database id in `wrangler.toml` (see the comment there). Rollback is a redeploy of the previous
commit from the Pages dashboard, or revert + merge.
