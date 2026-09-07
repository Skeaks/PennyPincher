/**
 * Passive capture, end to end: consent check, adapter lookup, extraction, completion into a
 * `PriceObservation`, append to the local store. Plus the page watcher that re-runs it on SPA
 * route changes (MutationObserver, 500 ms debounce).
 *
 * Two surfaces (S17). On a product URL (the standalone page or the modal over a listing) the
 * hero price is one observation. On a listing URL (search, aisle, storefront) every priced
 * tile is one observation, and the count for the page is kept for the popup (`tally.ts`).
 *
 * Passive only. Nothing here clicks, navigates, submits, or requests. Every collaborator is
 * injected (`CaptureDeps`) so the whole flow is testable against fixture documents.
 */
import { type PriceObservation, SCHEMA_VERSION } from "@pennypincher/schema";
import { browser } from "wxt/browser";
import { hasConsent } from "../lib/consent";
import { append } from "../store";
import {
  type Adapter,
  type AdapterObservation,
  type ExtractFailureReason,
  type PageContext,
  type TileExtraction,
  canonicalUrl,
} from "./adapter";
import { pageContext, viewportOf } from "./context";
import { getPanelistId } from "./panelist";
import { ADAPTERS, findAdapter, runAdapter } from "./registry";
import { recordListingTally } from "./tally";

export interface CaptureDeps {
  hasConsent: () => Promise<boolean>;
  /** Store append. The real one validates and re-checks consent itself. */
  append: (observation: unknown) => Promise<number>;
  panelistId: () => Promise<string>;
  clientVersion: string;
  now: () => Date;
  uuid: () => string;
  adapters?: readonly Adapter[];
  /** Remember how many prices a listing page recorded, for the popup. Optional in tests. */
  tally?: (listingUrl: string, recorded: number) => Promise<void>;
}

export type CaptureOutcome =
  | { status: "stored"; observation: PriceObservation }
  | { status: "no_consent" }
  | { status: "no_adapter" }
  | { status: "extract_failed"; adapter: string; reason: ExtractFailureReason; detail?: string }
  | { status: "duplicate" }
  | { status: "rejected"; error: string }
  /** A listing page: every priced tile was attempted. `stored` is what went into the store. */
  | {
      status: "listing";
      adapter: string;
      url: string;
      stored: PriceObservation[];
      duplicates: number;
      rejected: number;
      skipped: TileExtraction["skipped"];
    };

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

async function mint(extracted: AdapterObservation, deps: CaptureDeps): Promise<PriceObservation> {
  return buildObservation(extracted, {
    observationId: deps.uuid(),
    panelistId: await deps.panelistId(),
    observedAt: deps.now().toISOString(),
    clientVersion: deps.clientVersion,
  });
}

async function captureListing(
  adapter: Adapter,
  doc: Document,
  ctx: PageContext,
  deps: CaptureDeps,
  seen: Set<string>,
): Promise<CaptureOutcome> {
  const adapterId = `${adapter.name}@${adapter.version}`;
  const url = canonicalUrl(ctx.url) ?? ctx.url;
  const outcome: Extract<CaptureOutcome, { status: "listing" }> = {
    status: "listing",
    adapter: adapterId,
    url,
    stored: [],
    duplicates: 0,
    rejected: 0,
    skipped: {},
  };
  if (!adapter.extractTiles) return outcome;
  let extraction: TileExtraction;
  try {
    extraction = adapter.extractTiles(doc, ctx);
  } catch {
    outcome.skipped.adapter_threw = 1;
    return outcome;
  }
  outcome.skipped = extraction.skipped;
  for (const extracted of extraction.observations) {
    const key = dedupeKey(extracted);
    if (seen.has(key)) {
      outcome.duplicates += 1;
      continue;
    }
    const observation = await mint(extracted, deps);
    try {
      await deps.append(observation);
    } catch {
      outcome.rejected += 1;
      continue;
    }
    seen.add(key);
    outcome.stored.push(observation);
  }
  return outcome;
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

  if (adapter.pageKind(ctx.url) === "listing") {
    return captureListing(adapter, doc, ctx, deps, seen);
  }

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

  const observation = await mint(result.observation, deps);
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
 * Running count of prices recorded per listing page in this page session. A new search on
 * the same path (the URL's query changes, the page does not reload) starts the count over, so
 * the popup's number is for the results the shopper is looking at.
 */
export class ListingCounter {
  private readonly counts = new Map<string, { href: string; recorded: number }>();

  /** Add `stored` for the listing at `href`; returns the count now. */
  add(canonical: string, href: string, stored: number): number {
    const entry = this.counts.get(canonical);
    const recorded = entry && entry.href === href ? entry.recorded + stored : stored;
    this.counts.set(canonical, { href, recorded });
    return recorded;
  }
}

/** A URL without its fragment: what tells one search from the next inside a page session. */
function hrefWithoutFragment(href: string): string {
  const i = href.indexOf("#");
  return i === -1 ? href : href.slice(0, i);
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
  const counter = new ListingCounter();
  let chain: Promise<unknown> = Promise.resolve();
  const attempt = (): void => {
    chain = chain
      .then(async () => {
        const href = win.location.href;
        const outcome = await captureOnce(win.document, pageContext(viewportOf(win)), deps, seen);
        if (outcome.status === "listing" && deps.tally) {
          const recorded = counter.add(
            outcome.url,
            hrefWithoutFragment(href),
            outcome.stored.length,
          );
          await deps.tally(outcome.url, recorded).catch(() => undefined);
        }
        return outcome;
      })
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
    tally: (url, recorded) => recordListingTally(url, recorded),
  };
}
