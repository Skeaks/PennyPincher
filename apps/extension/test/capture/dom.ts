/**
 * Fixture loading for adapter tests. Pages come from fixtures/<retailer>/ (human-owned ground
 * truth, never edited here) and are parsed with happy-dom. No network, ever.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Fulfillment, Retailer } from "@pennypincher/schema";
import { Window } from "happy-dom";

export const FIXTURES_DIR = join(__dirname, "..", "..", "..", "..", "fixtures");

/** The parts of the `.meta.json` sidecar an adapter test asserts on. */
export interface FixtureMeta {
  retailer: Retailer;
  fulfillment: Fulfillment;
  sessionState: "logged_in" | "logged_out";
  zip3: string;
  store: { retailerStoreId: string; label: string };
  expected: {
    price: { amountMinor: number; currency: "USD" };
    priceText: string;
    title: string;
    retailerSku: string;
  };
  notes?: string;
}

export interface Fixture {
  slug: string;
  html: string;
  meta: FixtureMeta;
}

export function listFixtures(retailer: string): Fixture[] {
  const dir = join(FIXTURES_DIR, retailer);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".html"))
    .sort()
    .map((name) => {
      const slug = basename(name, ".html");
      const html = readFileSync(join(dir, name), "utf8");
      const meta = JSON.parse(readFileSync(join(dir, `${slug}.meta.json`), "utf8")) as FixtureMeta;
      return { slug, html, meta };
    });
}

/** Parse an HTML string into a Document the way a content script would see it. */
export function parseDocument(html: string, url = "https://www.instacart.com/"): Document {
  const window = new Window({ url });
  window.document.write(html);
  return window.document as unknown as Document;
}

/** A tiny document built from a body fragment, for negative and edge-case tests. */
export function fragmentDocument(bodyHtml: string, url?: string): Document {
  return parseDocument(`<!doctype html><html><head></head><body>${bodyHtml}</body></html>`, url);
}
