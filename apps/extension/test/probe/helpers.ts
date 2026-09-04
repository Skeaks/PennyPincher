/**
 * Shared helpers for the probe tests. Observations come from fixture pages through the real
 * adapter (Instacart) or from fixture sidecars (Target, Walmart: no adapter until S12). No
 * network, ever: `fetchPage` is always a fake that returns fixture HTML.
 */
import type { PriceObservation } from "@pennypincher/schema";
import type {
  Adapter,
  AdapterObservation,
  ExtractResult,
  PageContext,
} from "../../src/capture/adapter";
import { instacartAdapter } from "../../src/capture/adapters/instacart";
import { runAdapter } from "../../src/capture/registry";
import { buildObservation } from "../../src/capture/run";
import { hasConsent } from "../../src/lib/consent";
import { handleExtractRequest } from "../../src/probe/content";
import { PROBE_EXTRACT } from "../../src/probe/messages";
import type { ProbeDeps } from "../../src/probe/probe";
import { append } from "../../src/store";
import { type Fixture, listFixtures, parseDocument } from "../capture/dom";

export const URL_BANANAS =
  "https://www.instacart.com/store/wegmans/products/2748189-bananas-sold-by-the-each";
export const URL_STRAWBERRIES =
  "https://www.instacart.com/store/wegmans/products/2748254-wegmans-organic-strawberries-16-oz";
export const URL_TARGET_BANANA =
  "https://www.target.com/p/fresh-banana-each-good-38-gather-8482/-/A-15013944";
export const URL_WALMART_BANANA = "https://www.walmart.com/ip/Fresh-Banana-Each/44390948";

export const PANELIST = "0b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8";
export const T0 = new Date("2026-09-04T15:30:00.000Z");

export function fixture(retailer: string, slug: string): Fixture {
  const found = listFixtures(retailer).find((f) => f.slug === slug);
  if (!found) throw new Error(`fixture ${retailer}/${slug} missing`);
  return found;
}

/** Deterministic UUID v4-shaped ids from a counter. */
export function uuidSeq(prefix = "0"): () => string {
  let n = 0;
  return () => `${prefix.padStart(8, "0")}-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

/** A logged-in observation of an Instacart fixture, exactly as passive capture would mint it. */
export function ownInstacartObservation(
  fx: Fixture,
  url: string,
  observationId = "11111111-0000-4000-8000-000000000001",
): PriceObservation {
  const ctx: PageContext = { url, surface: "web", device: "desktop" };
  const result = instacartAdapter.extract(parseDocument(fx.html, url), ctx);
  if (!result.ok) throw new Error(`fixture ${fx.slug} did not extract: ${result.reason}`);
  return buildObservation(result.observation, {
    observationId,
    panelistId: PANELIST,
    observedAt: T0.toISOString(),
    clientVersion: "0.1.0",
  });
}

/**
 * The page-derived part of an observation, from a fixture's sidecar. For retailers without an
 * adapter yet (Target, Walmart until S12): the sidecar is human-owned ground truth for the page.
 */
export function sidecarAdapterObservation(fx: Fixture, url: string): AdapterObservation {
  const { meta } = fx;
  return {
    retailer: meta.retailer,
    store: { retailerStoreId: meta.store.retailerStoreId, label: meta.store.label },
    product: { retailerSku: meta.expected.retailerSku, title: meta.expected.title, url },
    facts: {
      price: meta.expected.price,
      priceText: meta.expected.priceText,
      isEstimate: false,
      promoTags: [],
      memberPrice: false,
    },
    context: {
      fulfillment: meta.fulfillment,
      sessionState: meta.sessionState,
      surface: "web",
      zip3: meta.zip3,
      device: "desktop",
    },
    adapter: `${meta.retailer}@0.0.0`,
    evidenceHash: "b".repeat(64),
  };
}

export function sidecarObservation(
  fx: Fixture,
  url: string,
  observationId = "22222222-0000-4000-8000-000000000001",
): PriceObservation {
  return buildObservation(sidecarAdapterObservation(fx, url), {
    observationId,
    panelistId: PANELIST,
    observedAt: T0.toISOString(),
    clientVersion: "0.1.0",
  });
}

/**
 * A stand-in adapter for a retailer that has none yet. It reads nothing from the page beyond
 * checking that the sidecar's price text is really in the HTML it was handed; the values come
 * from the sidecar. Replaced by the real adapter in S12.
 */
export function sidecarAdapter(fx: Fixture, matchHost: string): Adapter {
  return {
    name: fx.meta.retailer,
    version: "0.0.0",
    matches: (url) => new URL(url).hostname.endsWith(matchHost),
    extract(doc, ctx): ExtractResult {
      const text = doc.body?.textContent ?? "";
      if (!text.includes(fx.meta.expected.priceText)) return { ok: false, reason: "no_price" };
      const observation = sidecarAdapterObservation(fx, ctx.url);
      observation.context = {
        ...observation.context,
        sessionState: ctx.sessionState ?? observation.context.sessionState,
        ...(ctx.cleanSession === undefined ? {} : { cleanSession: ctx.cleanSession }),
      };
      return { ok: true, observation };
    },
  };
}

/** The content script's extract path, with happy-dom standing in for `DOMParser`. */
export function happyDomExtract(adapters?: readonly Adapter[]): ProbeDeps["extract"] {
  return async (html, ctx) =>
    handleExtractRequest(
      { type: PROBE_EXTRACT, html, ctx },
      (h) => parseDocument(h, ctx.url),
      adapters,
    );
}

/** Extract straight through an adapter on a happy-dom document (no message plumbing). */
export function directExtract(adapter: Adapter): ProbeDeps["extract"] {
  return async (html, ctx) => runAdapter(adapter, parseDocument(html, ctx.url), ctx);
}

export interface FakeFetch {
  fetchPage: ProbeDeps["fetchPage"];
  calls: string[];
}

/** A fetch that returns `html` for every URL and records what it was asked for. */
export function fakeFetch(html: string | (() => string)): FakeFetch {
  const calls: string[] = [];
  return {
    calls,
    fetchPage: async (url) => {
      calls.push(url);
      return { ok: true, html: typeof html === "function" ? html() : html, status: 200 };
    },
  };
}

export function probeDeps(overrides: Partial<ProbeDeps> = {}): ProbeDeps {
  return {
    hasConsent,
    fetchPage: async () => ({ ok: false, reason: "network_error", detail: "no fetch in test" }),
    extract: happyDomExtract(),
    append,
    clientVersion: "0.1.0",
    now: () => T0,
    uuid: uuidSeq("a"),
    ...overrides,
  };
}

/** Change the hero price on a copy of an Instacart fixture page. */
export function withPrice(html: string, priceLine: string): string {
  const doc = parseDocument(html, URL_BANANAS);
  let changed = 0;
  for (const span of Array.from(doc.querySelectorAll("#item_details span.screen-reader-only"))) {
    if (/^current price:/i.test(span.textContent ?? "")) {
      span.textContent = `Current price: ${priceLine}`;
      changed += 1;
    }
  }
  if (changed === 0) throw new Error("no price label to change");
  return doc.documentElement.outerHTML;
}

/** A page an anonymous visitor might get instead of the product: a sign-in wall, no price. */
export const LOGIN_WALL_HTML =
  '<!doctype html><html><head></head><body class="body--auth-modal-open">' +
  '<div id="commonHeader"><button>Log in</button></div>' +
  '<div id="item_details"><h1>Log in to see prices</h1><p>Sign in to continue shopping.</p></div>' +
  "</body></html>";
