---
id: S16
title: Closed pilot + variance gate
role: all
depends_on: [S15]
owns:
  - docs/pilot/**
  - packages/stats/**      # recalibration only
human_review_required: true
---

## Context

First real data. One metro, one retailer, the top 200 SKUs by observation count. Target 30 to
60 panelists for two weeks. Everything before this ran on synthetic ladders.

## Acceptance

- `docs/pilot/plan.md`: metro, retailer, recruiting source, the SKU list, start and end dates.
- Weekly `docs/pilot/week-N.md` produced by a script `tools/pilot-report` that reads the API
  and writes: panelists active, observations, cells with N >= threshold, cells `RESOLVED`,
  share of resolved cells with more than one tier, distribution of tier counts, max spread,
  lever-probe difference rate by retailer, adapter health.
- Reconciliation: do real tier shares look like synth's assumptions? Recalibrate the 1.5
  constant and the rare-tier guard in `packages/stats` if the data says so, with the evidence
  in the PR.
- **The decision, written down in `docs/pilot/decision.md`:**
  - If >= 20% of resolved cells show multiple tiers: Track B is real. Phase 2 briefs are the
    basket optimizer and savings receipt.
  - If the lever probe finds logged-in vs logged-out differences on >= 10% of checks but cells
    are single-tier: Track A is the product. Phase 2 briefs are the ZIP/fulfilment probes and
    the subscription.
  - If neither: the pivot. Phase 2 briefs are "one-price certified" and the conventional
    levers list from the research doc.
- Counsel has reviewed ADR 0003 before any panelist outside Jamie's personal network installs.

## Out of scope

- Fixing anything the pilot reveals beyond stats recalibration. Bugs become S17+ briefs.
