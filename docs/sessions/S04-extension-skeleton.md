---
id: S04
title: Extension skeleton + consent
role: capture
depends_on: [S00]
owns:
  - docs/sessions/S04.outcome.md
  - apps/extension/**
---

## Context

The MV3 extension with nothing in it yet except the parts that must be right from day one:
consent before anything runs, a local-only observation store, and no network calls at all. Read
`docs/decisions/0003-capture-posture.md` first.

## Acceptance

- `apps/extension` is a WXT project. `pnpm --filter extension dev` produces a loadable unpacked
  build; `pnpm --filter extension build` produces `.output/chrome-mv3`.
- `manifest`: host permissions for exactly `instacart.com`, `target.com`, `walmart.com`
  (subdomains ok). Permissions: `storage`, `alarms`. Nothing else. No `cookies`, no
  `webRequest`, no `tabs`.
- Consent screen opens on install. Plain-language list of what is and is not collected, a
  "Delete everything" statement, and a single opt-in. Nothing runs until accepted. Consent
  version stored; changing `CONSENT_VERSION` re-prompts.
- Options page: consent status, count of locally stored observations, "Export my data" (JSON
  download), "Delete my data" (clears local store).
- `apps/extension/src/store/`: append-only local observation store on `chrome.storage.local`,
  typed with `@pennypincher/schema`, capped at 5,000 rows FIFO.
- No `fetch` anywhere in the extension. Unit tests (Vitest, `@webext-core/fake-browser` or
  equivalent) for consent gating and the store cap.
- `pnpm gate` green; `scripts/check-forbidden-api.sh` clean.

## Out of scope

- Reading any price from any page (S05).
- Sending anything anywhere (S07/S11).
- Popup UI beyond a placeholder (S11).
