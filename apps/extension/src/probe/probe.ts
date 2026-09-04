/**
 * One lever probe, end to end, with every collaborator injected so the whole flow runs on
 * fixture HTML in tests:
 *
 *   validate the triggering observation -> is the user logged in? -> consent? -> adapter? ->
 *   claim this hour for the SKU -> fetch the page anonymously -> extract with the same adapter
 *   -> mint the anonymous observation (same panelist, `logged_out`, `cleanSession`) -> compare
 *   -> store both the observation and the result.
 *
 * The hour is claimed before the fetch and kept on every failure, so a login wall or a bot
 * check is hit at most once per SKU per hour.
 */
import type { PriceObservation } from "@pennypincher/schema";
import type { Adapter, ExtractResult, PageContext } from "../capture/adapter";
import { ADAPTERS, findAdapter } from "../capture/registry";
import { buildObservation } from "../capture/run";
import { validateObservation } from "../store";
import { compare, pricePoint } from "./compare";
import type { PageFetch } from "./fetch";
import { recordResult, reserveProbe, updateProbeState } from "./state";
import { type ProbeFailureReason, type ProbeResult, probeKey } from "./types";

export interface ProbeDeps {
  hasConsent: () => Promise<boolean>;
  /** The anonymous fetch. Never throws. */
  fetchPage: (url: string) => Promise<PageFetch>;
  /** Parse + extract, wherever a DOM lives. May reject; that is `extract_unavailable`. */
  extract: (html: string, ctx: PageContext) => Promise<ExtractResult>;
  /** Observation store append. The real one validates and re-checks consent itself. */
  append: (observation: unknown) => Promise<number>;
  clientVersion: string;
  now: () => Date;
  uuid: () => string;
  adapters?: readonly Adapter[];
}

export type ProbeSkipReason =
  | "invalid_observation"
  | "not_logged_in"
  | "no_consent"
  | "no_adapter"
  | "rate_limited";

export type ProbeOutcome =
  | { status: "skipped"; reason: ProbeSkipReason }
  | { status: "checked"; result: ProbeResult };

/** The context the anonymous page is extracted under: same surface and device, no session. */
export function anonymousContext(mine: PriceObservation): PageContext {
  return {
    url: mine.product.url,
    surface: mine.context.surface,
    device: mine.context.device,
    sessionState: "logged_out",
    cleanSession: true,
  };
}

function unchecked(
  base: Omit<ProbeResult, "verdict">,
  reason: ProbeFailureReason,
  detail?: string,
): ProbeResult {
  const result: ProbeResult = { ...base, verdict: "UNCHECKED", reason };
  if (detail !== undefined && detail !== "") result.detail = detail;
  return result;
}

async function persist(result: ProbeResult): Promise<ProbeOutcome> {
  await updateProbeState((state) => recordResult(state, result));
  return { status: "checked", result };
}

export async function probeObservation(input: unknown, deps: ProbeDeps): Promise<ProbeOutcome> {
  let mine: PriceObservation;
  try {
    mine = validateObservation(input);
  } catch {
    return { status: "skipped", reason: "invalid_observation" };
  }
  if (mine.context.sessionState !== "logged_in") {
    return { status: "skipped", reason: "not_logged_in" };
  }
  if (!(await deps.hasConsent())) return { status: "skipped", reason: "no_consent" };
  const adapter = findAdapter(mine.product.url, deps.adapters ?? ADAPTERS);
  if (!adapter || adapter.name !== mine.retailer) {
    return { status: "skipped", reason: "no_adapter" };
  }

  const key = probeKey(mine.retailer, mine.product.retailerSku);
  const nowMs = deps.now().getTime();
  let reserved = false;
  await updateProbeState((state) => {
    reserved = reserveProbe(state, key, nowMs);
  });
  if (!reserved) return { status: "skipped", reason: "rate_limited" };

  const base: Omit<ProbeResult, "verdict"> = {
    key,
    retailer: mine.retailer,
    retailerSku: mine.product.retailerSku,
    url: mine.product.url,
    checkedAt: deps.now().toISOString(),
    mine: pricePoint(mine),
  };

  const page = await deps.fetchPage(mine.product.url);
  if (!page.ok) return persist(unchecked(base, page.reason, page.detail));

  let extracted: ExtractResult;
  try {
    extracted = await deps.extract(page.html, anonymousContext(mine));
  } catch (e) {
    return persist(unchecked(base, "extract_unavailable", e instanceof Error ? e.message : ""));
  }
  if (!extracted.ok) return persist(unchecked(base, extracted.reason, extracted.detail));
  if (extracted.observation.product.retailerSku !== mine.product.retailerSku) {
    return persist(unchecked(base, "sku_mismatch", extracted.observation.product.retailerSku));
  }

  const anon = buildObservation(extracted.observation, {
    observationId: deps.uuid(),
    panelistId: mine.panelistId,
    observedAt: deps.now().toISOString(),
    clientVersion: deps.clientVersion,
  });
  try {
    await deps.append(anon);
  } catch (e) {
    return persist(unchecked(base, "store_rejected", e instanceof Error ? e.message : ""));
  }

  const comparison = compare(mine, anon);
  const result: ProbeResult = { ...base, verdict: comparison.verdict, anon: pricePoint(anon) };
  if (comparison.verdict === "UNCHECKED") result.reason = comparison.reason;
  if ("deltaMinor" in comparison) result.deltaMinor = comparison.deltaMinor;
  return persist(result);
}
