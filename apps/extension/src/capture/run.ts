/**
 * Passive capture, end to end: consent check, adapter lookup, extraction, completion into a
 * `PriceObservation`, append to the local store. Plus the page watcher that re-runs it on SPA
 * route changes (MutationObserver, 500 ms debounce).
 *
 * Passive only. Nothing here clicks, navigates, submits, or requests. Every collaborator is
 * injected (`CaptureDeps`) so the whole flow is testable against fixture documents.
 */
import { type PriceObservation, SCHEMA_VERSION } from "@pennypincher/schema";
import { browser } from "wxt/browser";
import { hasConsent } from "../lib/consent";
import { append } from "../store";
import type { Adapter, AdapterObservation, ExtractFailureReason, PageContext } from "./adapter";
import { pageContext, viewportOf } from "./context";
import { getPanelistId } from "./panelist";
import { ADAPTERS, findAdapter, runAdapter } from "./registry";

export interface CaptureDeps {
  hasConsent: () => Promise<boolean>;
  /** Store append. The real one validates and re-checks consent itself. */
  append: (observation: unknown) => Promise<number>;
  panelistId: () => Promise<string>;
  clientVersion: string;
  now: () => Date;
  uuid: () => string;
  adapters?: readonly Adapter[];
}

export type CaptureOutcome =
  | { status: "stored"; observation: PriceObservation }
  | { status: "no_consent" }
  | { status: "no_adapter" }
  | { status: "extract_failed"; adapter: string; reason: ExtractFailureReason; detail?: string }
  | { status: "duplicate" }
  | { status: "rejected"; error: string };

export interface Minted {
  observationId: string;
  panelistId: string;
  observedAt: string;
  clientVersion: string;
}

/** Complete an adapter's page-derived observation with the client-minted fields. */
export function buildObservation(extracted: AdapterObservation, minted: Minted): PriceObservation {
  const { adapter, evidenceHash, store, ...rest } = extracted;
  const observation: PriceObservation = {
    schemaVersion: SCHEMA_VERSION,
    observationId: minted.observationId,
    panelistId: minted.panelistId,
    observedAt: minted.observedAt,
    ...rest,
    provenance: { adapter, clientVersion: minted.clientVersion, evidenceHash },
  };
  if (store) observation.store = store;
  return observation;
}

/** What makes two captures "the same rendering": same page, same evidence, same price. */
export function dedupeKey(o: AdapterObservation): string {
  return `${o.product.url}|${o.evidenceHash}|${o.facts.price.amountMinor}`;
}

/**
 * One capture attempt. Consent is checked before the page is read at all; without it the
 * adapter is never invoked. `seen` (per page session) suppresses re-writes of an unchanged
 * rendering when the observer fires for unrelated DOM churn.
 */
export async function captureOnce(
  doc: Document,
  ctx: PageContext,
  deps: CaptureDeps,
  seen: Set<string> = new Set(),
): Promise<CaptureOutcome> {
  if (!(await deps.hasConsent())) return { status: "no_consent" };

  const adapter = findAdapter(ctx.url, deps.adapters ?? ADAPTERS);
  if (!adapter) return { status: "no_adapter" };

  const result = runAdapter(adapter, doc, ctx);
  if (!result.ok) {
    const adapterId = `${adapter.name}@${adapter.version}`;
    return result.detail === undefined
      ? { status: "extract_failed", adapter: adapterId, reason: result.reason }
      : {
          status: "extract_failed",
          adapter: adapterId,
          reason: result.reason,
          detail: result.detail,
        };
  }

  const key = dedupeKey(result.observation);
  if (seen.has(key)) return { status: "duplicate" };

  const observation = buildObservation(result.observation, {
    observationId: deps.uuid(),
    panelistId: await deps.panelistId(),
    observedAt: deps.now().toISOString(),
    clientVersion: deps.clientVersion,
  });
  try {
    await deps.append(observation);
  } catch (e) {
    return { status: "rejected", error: e instanceof Error ? e.message : String(e) };
  }
  seen.add(key);
  return { status: "stored", observation };
}

export const DEBOUNCE_MS = 500;

export interface WatchOptions {
  debounceMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/**
 * Calls `onSettled` once the DOM has been quiet for `debounceMs` after any mutation. Returns a
 * function that stops watching. Observes only; never touches the page.
 */
export function watchPage(
  doc: Document,
  onSettled: () => void,
  opts: WatchOptions = {},
): () => void {
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  const set = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let pending: unknown;
  // The document's own window, so a parsed document (tests, the S06 probe) works too.
  const Observer = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  const observer = new Observer(() => {
    if (pending !== undefined) clear(pending);
    pending = set(() => {
      pending = undefined;
      onSettled();
    }, debounceMs);
  });
  const root = doc.body ?? doc.documentElement;
  if (root) observer.observe(root, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    if (pending !== undefined) clear(pending);
    pending = undefined;
  };
}

/**
 * Wire capture to a window: one attempt now, another whenever the page settles after a
 * mutation (covers SPA route changes, which change the URL without a load). Runs are
 * serialised so a slow store write cannot interleave with the next attempt.
 */
export function startCapture(
  win: Window,
  deps: CaptureDeps,
  opts: WatchOptions = {},
  onOutcome: (outcome: CaptureOutcome) => void = () => {},
): () => void {
  const seen = new Set<string>();
  let chain: Promise<unknown> = Promise.resolve();
  const attempt = (): void => {
    chain = chain
      .then(() => captureOnce(win.document, pageContext(viewportOf(win)), deps, seen))
      .then(onOutcome, () => undefined);
  };
  attempt();
  return watchPage(win.document, attempt, opts);
}

/** The real collaborators. Only the content-script entrypoint calls this. */
export function defaultDeps(): CaptureDeps {
  return {
    hasConsent,
    append,
    panelistId: () => getPanelistId(),
    clientVersion: browser.runtime.getManifest().version,
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
  };
}
