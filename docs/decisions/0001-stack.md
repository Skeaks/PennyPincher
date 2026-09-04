# ADR 0001: Stack

**Status:** accepted, 2026-09-04

## Decision

- **Language:** TypeScript everywhere, strict, `noUncheckedIndexedAccess` on.
- **Repo:** pnpm workspaces monorepo. `packages/*` are libraries, `apps/*` are deployables.
- **Lint + format:** Biome. One tool, one config, sub-second.
- **Tests:** Vitest. Property tests with `fast-check` where a ground truth exists (stats).
- **Validation:** Zod. The schema package is the single source of truth for payload shapes.
- **Extension:** WXT (MV3, HMR, typed manifest).
- **API:** Hono on Cloudflare Workers. Storage: Cloudflare D1 behind a repository interface.
- **Web:** static site on Cloudflare Pages. No framework until a page needs state.
- **Deploy:** `wrangler` from GitHub Actions on merge to `main`. No release script.

## Why

The deploy loop must be 1 to 5 minutes. Every choice above deploys by replacing an artifact
atomically in seconds and needs no server to operate. See `CONTRIBUTING.md` for the verstill
lessons this encodes.

## Consequences

- SQLite limits: no window-function-heavy analytics at scale. The stats engine works on
  per-cell observation arrays pulled by the API, not in SQL. Migrate to Postgres (Neon +
  Hyperdrive) when a query cannot be expressed or rows exceed ~50M. The repository layer in
  `apps/api/src/repo/` is the only thing that changes.
- WXT pins the extension to Vite's build; fine.
- No Next.js means no server-rendered logged-in web app. Revisit when a non-extension user
  exists.
