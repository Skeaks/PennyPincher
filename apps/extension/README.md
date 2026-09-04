# PennyPincher extension

MV3 extension built with [WXT](https://wxt.dev). Session S04 skeleton: consent gate, local
observation store, options page. No capture yet (S05), no network at all (S07/S11).

```bash
pnpm --filter extension build   # -> .output/chrome-mv3   (the manifest that ships)
pnpm --filter extension dev     # -> .output/chrome-mv3-dev, hot reload; adds WXT dev-only perms
pnpm --filter extension test
```

Load unpacked: `chrome://extensions`, Developer mode, "Load unpacked", pick the `.output`
directory above. The consent page opens on install.

Layout (`src/`):

- `manifest.ts`: permissions and host permissions, pinned by `test/posture.test.ts`.
- `lib/consent.ts`: `CONSENT_VERSION`; bump it whenever the collected fields change.
- `lib/copy.ts`: every user-facing consent sentence. Regulated words need a `claims-reviewed` label.
- `store/`: append-only, validated, consent-gated, 5,000-row FIFO on `chrome.storage.local`.
- `entrypoints/`: `background.ts`, `consent/`, `options/`, `popup/` (placeholder until S11).
