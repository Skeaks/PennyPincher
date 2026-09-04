# PennyPincher extension

MV3 extension built with [WXT](https://wxt.dev). Consent gate, local observation store, options
page (S04); passive capture with the Instacart adapter (S05); the lever probe (S06), which makes
the extension's only network request: the public page of the product being viewed, fetched
without credentials, once per product per hour. Upload arrives in S11.

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
