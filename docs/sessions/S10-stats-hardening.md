---
id: S10
title: Stats hardening
role: stats, platform
depends_on: [S09]
owns:
  - packages/stats/**
  - .github/workflows/nightly.yml   # separate PR, boundary-guard
---

## Acceptance

- Stryker configured for `packages/stats` and (when it exists) `packages/normalize`. Runs in
  `nightly.yml` only. Threshold 60% reported, not enforced, for the first two weeks; then
  enforced at the observed score minus 5.
- Serial-correlation robustness: with synth `stickiness` on, the property test still never
  reports a floor below truth. Document how much more N it takes.
- Change-point stub: `detectShift(observations)` returns `{ shifted: boolean, at?: ISO }` using a
  simple CUSUM on median price over time. Tested on synth with a planted shift. Marked
  experimental in the README.
- `packages/stats/README.md`: the formulas, the constants and why, the failure modes, and a
  worked example from synth.

## Out of scope

- Anything the UI needs beyond `resolve` and `explain`.
