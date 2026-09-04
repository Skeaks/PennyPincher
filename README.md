# PennyPincher

Retailers run randomized price experiments: the same item, the same store, the same minute,
five different prices depending on which bucket your account fell into. No single shopper can
see that. A panel can.

PennyPincher is a browser extension plus a consented panel. The extension records the price you
were already shown (client-side, passive, no login, no credentials). The panel pools those
observations. A stats engine reconstructs the full price distribution for each item and tells you
which rung you are on, what the floor is, and how many observers that estimate rests on. When
there are not enough observers, it says `UNRESOLVED` rather than guess.

It also answers a simpler question for you alone: **is being logged in, choosing delivery, or
your ZIP changing this price right now?** That is the lever probe, and it works on day one with
zero other users.

## Status

Foundation. See [`docs/sessions/README.md`](docs/sessions/README.md) for the build sequence and
[`docs/CRITIQUE.md`](docs/CRITIQUE.md) for why the plan looks the way it does.

## Repo

```
packages/schema     the observation contract (start here)
apps/               extension, api, web (added session by session)
docs/sessions/      one brief per Claude Code session
docs/decisions/     architecture decision records
docs/plan/          the original strategy and work plan this grew from
```

## Develop

```bash
pnpm install
pnpm gate        # lint + typecheck + test + guards, identical to CI
```

Agents: read [`CLAUDE.md`](CLAUDE.md) then [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Principles

- **Client-side, passive, consented.** The extension reads what the browser already rendered.
- **Never a confidently wrong floor.** `UNRESOLVED` is a first-class answer.
- **No affiliate-weighted ranking. No "up to X%" claims.** Every savings figure is an interval
  with its N disclosed.
- **Ship in minutes.** The gate is fast and runs once. Merge is deploy.
