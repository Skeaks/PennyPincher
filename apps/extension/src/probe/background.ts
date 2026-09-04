/**
 * Background wiring for the probe: listen for stored observations, run the probe with the
 * real collaborators, and keep the rate table pruned on an hourly alarm (`alarms` was already
 * in the manifest for this). Every decision lives in `probe.ts`.
 */
import { browser } from "wxt/browser";
import type { ExtractResult, PageContext } from "../capture/adapter";
import { hasConsent } from "../lib/consent";
import { append } from "../store";
import { fetchLoggedOut } from "./fetch";
import { PROBE_EXTRACT, isObservedMessage } from "./messages";
import { type ProbeDeps, type ProbeOutcome, probeObservation } from "./probe";
import { pruneRate, updateProbeState } from "./state";

export const PRUNE_ALARM = "pp:probe-prune";
export const PRUNE_PERIOD_MINUTES = 60;

function isExtractResult(value: unknown): value is ExtractResult {
  return (
    typeof value === "object" && value !== null && typeof (value as ExtractResult).ok === "boolean"
  );
}

/** Extract by round trip to the tab that produced the observation; only it has a DOM. */
export function extractViaTab(tabId: number): ProbeDeps["extract"] {
  return async (html: string, ctx: PageContext): Promise<ExtractResult> => {
    const reply: unknown = await browser.tabs.sendMessage(tabId, {
      type: PROBE_EXTRACT,
      html,
      ctx,
    });
    if (!isExtractResult(reply)) throw new Error("no extract reply from tab");
    return reply;
  };
}

export type BackgroundProbeDeps = Omit<ProbeDeps, "extract">;

export function defaultBackgroundDeps(): BackgroundProbeDeps {
  return {
    hasConsent,
    fetchPage: fetchLoggedOut,
    append,
    clientVersion: browser.runtime.getManifest().version,
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
  };
}

export async function pruneStoredRate(nowMs: number): Promise<void> {
  await updateProbeState((state) => pruneRate(state, nowMs));
}

/**
 * Wire the listeners. `extractFor` defaults to the tab round trip; tests inject a happy-dom
 * parse. Registered synchronously so a service worker that just woke up still gets the message.
 */
export function registerProbe(
  deps: BackgroundProbeDeps = defaultBackgroundDeps(),
  extractFor: (tabId: number) => ProbeDeps["extract"] = extractViaTab,
  onOutcome: (outcome: ProbeOutcome) => void = () => {},
): void {
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isObservedMessage(message)) return false;
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    void probeObservation(message.observation, { ...deps, extract: extractFor(tabId) }).then(
      onOutcome,
      () => undefined,
    );
    return false;
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PRUNE_ALARM) void pruneStoredRate(deps.now().getTime());
  });
  void browser.alarms.create(PRUNE_ALARM, { periodInMinutes: PRUNE_PERIOD_MINUTES });
}
