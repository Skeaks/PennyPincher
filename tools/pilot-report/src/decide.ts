/**
 * The S16 decision, as the brief writes it, applied to numbers:
 *
 *  - Track B is real when >= 20% of RESOLVED cells show more than one tier.
 *  - Track A is the product when the lever probe finds a logged-in vs logged-out difference on
 *    >= 10% of comparable checks while the cells are single-tier.
 *  - Neither: the pivot ("one-price certified", the conventional levers).
 *
 * One rule the brief did not state and the numbers need: a share of very few cells is not
 * evidence. Below `minResolvedCells` RESOLVED cells the multi-tier share is unknown, not
 * zero, and below `minProbeChecks` comparable checks the probe rate is unknown. The verdict
 * is then INCONCLUSIVE with the shortfall named, and the pilot runs on. The thresholds are in
 * `docs/pilot/pilot.json`; the defaults (20 cells, 50 checks) are this session's proposal.
 *
 * The decision is `final` only when counsel has reviewed ADR 0003 (the brief's last line) and
 * the verdict is not INCONCLUSIVE.
 */
import type { PilotConfig } from "./config";

export type Verdict = "TRACK_B" | "TRACK_A" | "PIVOT" | "INCONCLUSIVE";

export interface DecisionInputs {
  resolvedCells: number;
  multiTierCells: number;
  comparableChecks: number;
  differences: number;
}

export interface Decision {
  verdict: Verdict;
  multiTierShare: number | null;
  differenceRate: number | null;
  /** Why, one line each, in the order the rules were checked. */
  reasons: string[];
  /** The Phase 2 briefs this verdict calls for, from the brief and docs/sessions/README.md. */
  phase2: string[];
  final: boolean;
}

export const PHASE_2: Record<Exclude<Verdict, "INCONCLUSIVE">, string[]> = {
  TRACK_B: [
    "Basket optimizer: multi-retailer assignment including fees, minimums, memberships.",
    "The receipt: observed floor vs price paid, as an interval with N. Never a point estimate.",
  ],
  TRACK_A: [
    "ZIP and fulfilment probes: does the shopper's ZIP or delivery / pickup path move their price right now.",
    "The subscription: the lever probe plus alerts, across every covered retailer (CRITIQUE §6).",
  ],
  PIVOT: [
    "One-price certified: the B2B badge for retailers who do not personalise, backed by the panel (CRITIQUE §6).",
    "The conventional levers from the research doc: price-match automation, loyalty and digital-coupon clipping, unit-price and store-brand substitution, fulfilment-path fee arbitrage, price-drop alerts.",
  ],
};

export function decide(
  inputs: DecisionInputs,
  thresholds: PilotConfig["thresholds"],
  counselReviewed: string | null,
): Decision {
  const multiTierShare =
    inputs.resolvedCells === 0 ? null : inputs.multiTierCells / inputs.resolvedCells;
  const differenceRate =
    inputs.comparableChecks === 0 ? null : inputs.differences / inputs.comparableChecks;
  const cellsKnown = inputs.resolvedCells >= thresholds.minResolvedCells;
  const probeKnown = inputs.comparableChecks >= thresholds.minProbeChecks;
  const reasons: string[] = [];

  reasons.push(
    cellsKnown
      ? `${inputs.resolvedCells} RESOLVED cells (>= ${thresholds.minResolvedCells}): the multi-tier share ${pct(multiTierShare)} is evidence.`
      : `${inputs.resolvedCells} RESOLVED cells (< ${thresholds.minResolvedCells}): the multi-tier share is not evidence either way.`,
  );
  reasons.push(
    probeKnown
      ? `${inputs.comparableChecks} comparable probe checks (>= ${thresholds.minProbeChecks}): the difference rate ${pct(differenceRate)} is evidence.`
      : `${inputs.comparableChecks} comparable probe checks (< ${thresholds.minProbeChecks}): the difference rate is not evidence either way.`,
  );

  let verdict: Verdict;
  if (cellsKnown && multiTierShare !== null && multiTierShare >= thresholds.multiTierShare) {
    verdict = "TRACK_B";
    reasons.push(
      `Multi-tier share ${pct(multiTierShare)} >= ${pct(thresholds.multiTierShare)}: Track B is real.`,
    );
  } else if (
    probeKnown &&
    differenceRate !== null &&
    differenceRate >= thresholds.probeDifferenceRate
  ) {
    verdict = "TRACK_A";
    reasons.push(
      cellsKnown
        ? `Probe difference rate ${pct(differenceRate)} >= ${pct(thresholds.probeDifferenceRate)} while cells are single-tier: Track A is the product.`
        : `Probe difference rate ${pct(differenceRate)} >= ${pct(thresholds.probeDifferenceRate)}; the cells could not be judged, so Track A on the probe evidence alone. Note it in the decision.`,
    );
  } else if (cellsKnown && probeKnown) {
    verdict = "PIVOT";
    reasons.push(
      `Neither threshold met (multi-tier ${pct(multiTierShare)} < ${pct(thresholds.multiTierShare)}, probe ${pct(differenceRate)} < ${pct(thresholds.probeDifferenceRate)}): the pivot.`,
    );
  } else {
    verdict = "INCONCLUSIVE";
    reasons.push(
      "Neither threshold met and at least one minimum unmet: no decision yet. Extend the pilot or widen recruiting before calling it.",
    );
  }

  if (counselReviewed === null) {
    reasons.push(
      "Counsel has not reviewed ADR 0003 (pilot.json: counselReviewed is null); the decision is not final.",
    );
  }

  return {
    verdict,
    multiTierShare,
    differenceRate,
    reasons,
    phase2: verdict === "INCONCLUSIVE" ? [] : PHASE_2[verdict],
    final: verdict !== "INCONCLUSIVE" && counselReviewed !== null,
  };
}

function pct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
}
