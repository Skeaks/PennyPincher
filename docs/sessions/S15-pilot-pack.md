---
id: S15
title: Pilot pack
role: compliance, web, platform
depends_on: [S06, S11, S14]
owns:
  - docs/compliance/**
  - apps/extension/src/copy/**
  - apps/web/**
  - .github/workflows/deploy.yml   # separate PR for the Pages job
human_review_required: true   # claims copy, privacy policy
---

## Acceptance

- `docs/compliance/privacy-policy.md` and `consent.md`: plain English, list every field in the
  schema, the retention rules from S14, the deletion path, and that no credentials or cookies
  are ever read. Drafts for Jamie and counsel; marked DRAFT until reviewed.
- Extension copy moved to `src/copy/` as a single strings file; a test asserts none of the
  regulated words appear without a `// claims-reviewed` marker line and the PR label.
- Chrome Web Store: `pnpm --filter extension zip` produces the upload; `docs/webstore.md`
  lists the listing text, the permission justifications (one paragraph per host permission),
  and the unlisted-listing procedure. Jamie submits.
- `apps/web`: static landing page and waitlist form on Cloudflare Pages. Form posts to a
  Worker route that stores email only (this is the one place an email is stored; separate
  table, separate policy line). Deployed by a second job in `deploy.yml`.
- Landing copy explains the panel, the lever probe, and `UNRESOLVED`, with zero savings claims.

## Out of scope

- Public launch. This is for the 30 to 60 pilot panelists.
