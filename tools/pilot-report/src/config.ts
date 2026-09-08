/**
 * The pilot's configuration, `docs/pilot/pilot.json`. One file so the plan, the weekly
 * reports and the decision all quote the same metro, retailer, dates and thresholds.
 *
 * `retailer` must be one of the schema's retailers: the report filters the export to it, and
 * a placeholder ("Y") would silently produce an empty report. Loading refuses instead.
 */
import { Retailer } from "@pennypincher/schema";
import { z } from "zod";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const PilotConfig = z.object({
  /** Free text: the metro the panel is recruited in. Never a full ZIP. */
  metro: z.string().min(1),
  /** The one retailer the cell metrics are computed over. Probe rates cover every retailer. */
  retailer: Retailer,
  /** zip3 prefixes the metro spans; informative, reported per week so drift is visible. */
  zip3s: z.array(z.string().regex(/^\d{3}$/)).default([]),
  recruitingSource: z.string().min(1),
  /** First day of week 1, UTC. `null` until the preconditions in plan.md are met. */
  startDate: z.string().regex(DATE).nullable(),
  weeks: z.number().int().min(1).max(8).default(2),
  panelTarget: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
  skuCount: z.number().int().positive().default(200),
  /** Date counsel signed off ADR 0003, or null. The decision refuses to be final without it. */
  counselReviewed: z.string().regex(DATE).nullable(),
  apiBaseUrl: z.string().url(),
  thresholds: z
    .object({
      /** Track B: share of RESOLVED cells with more than one tier. */
      multiTierShare: z.number().min(0).max(1).default(0.2),
      /** Track A: MORE or LESS verdicts over comparable probe checks. */
      probeDifferenceRate: z.number().min(0).max(1).default(0.1),
      /** Below this many RESOLVED cells the multi-tier share is not evidence either way. */
      minResolvedCells: z.number().int().positive().default(20),
      /** Below this many comparable checks the probe rate is not evidence either way. */
      minProbeChecks: z.number().int().positive().default(50),
    })
    .default({}),
});
export type PilotConfig = z.infer<typeof PilotConfig>;

export type ConfigResult = { ok: true; config: PilotConfig } | { ok: false; errors: string[] };

export function parsePilotConfig(input: unknown): ConfigResult {
  const parsed = PilotConfig.safeParse(input);
  if (parsed.success) return { ok: true, config: parsed.data };
  const errors = parsed.error.issues.map((issue) => {
    const path = issue.path.join(".") || "(root)";
    if (path === "retailer") {
      return `retailer: must be one of ${Retailer.options.join(", ")} (a placeholder like "Y" is not a retailer; set it in docs/pilot/pilot.json)`;
    }
    return `${path}: ${issue.message}`;
  });
  return { ok: false, errors };
}

export interface WeekWindow {
  week: number;
  /** Inclusive, ISO-8601 UTC midnight. */
  from: string;
  /** Exclusive. */
  to: string;
}

/** Week N of the pilot: `[start + 7(N-1) days, start + 7N days)`, UTC. */
export function weekWindow(config: PilotConfig, week: number): WeekWindow {
  if (config.startDate === null) {
    throw new Error("startDate is null in docs/pilot/pilot.json; set it before reporting a week");
  }
  if (!Number.isInteger(week) || week < 1 || week > config.weeks) {
    throw new RangeError(`week must be between 1 and ${config.weeks}, got ${week}`);
  }
  const start = Date.parse(`${config.startDate}T00:00:00.000Z`);
  const day = 86_400_000;
  return {
    week,
    from: new Date(start + (week - 1) * 7 * day).toISOString(),
    to: new Date(start + week * 7 * day).toISOString(),
  };
}

/** The whole pilot, week 1 through `config.weeks`. */
export function pilotWindow(config: PilotConfig): WeekWindow {
  const first = weekWindow(config, 1);
  const last = weekWindow(config, config.weeks);
  return { week: 0, from: first.from, to: last.to };
}
