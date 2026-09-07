---
id: S15
title: Pilot pack
role: compliance, web, platform
depends_on: [S06, S11, S14]
owns:
  - docs/sessions/S15.outcome.md
  - docs/compliance/**
  - apps/extension/src/copy/**
  - apps/web/**
  - .github/workflows/deploy.yml   # separate PR for the Pages job
human_review_required: true   # claims copy, privacy policy
---

## Carried in from S12 and S14 retros (do these first)

- The consent copy (`src/lib/copy.ts`) describes the probe request, the 15-minute upload and
  the 7-day rotation, but not the ladder query or the daily adapter-health upload (counts
  only, no ids) or the delete call. Rewrite `howItWorks` to enumerate every request the
  extension makes, in one list, and bump `CONSENT_VERSION` to 6. `test/consent.test.ts`
  pins the copy; extend it so the test fails if a new `fetch` call site appears in
  `sync/transport.ts` without a matching line in the copy.
- `PANELIST_IDS_KEPT` in `src/identity/panelist.ts` is 4; raw retention is 90 days, which is
  13 rotations. Set it to 13 so "Delete my data" can name every id the server may still hold.
- The "Sent anywhere" paragraph on the options page still describes only the probe request.
  Same enumeration as the consent copy.

Add to `owns:` for this session: `apps/extension/src/lib/copy.ts`,
`apps/extension/src/lib/consent.ts`, `apps/extension/src/identity/panelist.ts`,
`apps/extension/src/entrypoints/options/**`, `apps/extension/test/consent.test.ts`.

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
