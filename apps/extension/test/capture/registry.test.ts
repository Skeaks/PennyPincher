/** The registry (S12): all three adapters ship, and the runner picks one by `matches(url)`. */
import { describe, expect, it } from "vitest";
import type { Adapter } from "../../src/capture/adapter";
import { instacartAdapter } from "../../src/capture/adapters/instacart";
import { targetAdapter } from "../../src/capture/adapters/target";
import { walmartAdapter } from "../../src/capture/adapters/walmart";
import { ADAPTERS, findAdapter, runAdapter } from "../../src/capture/registry";
import { captureOnce } from "../../src/capture/run";
import { fragmentDocument } from "./dom";

describe("ADAPTERS", () => {
  it("lists instacart, target and walmart, each under its own retailer name", () => {
    expect(ADAPTERS.map((a) => a.name)).toEqual(["instacart", "target", "walmart"]);
    expect(ADAPTERS).toEqual([instacartAdapter, targetAdapter, walmartAdapter]);
    for (const a of ADAPTERS) expect(a.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("no two adapters match the same URL", () => {
    const urls = [
      "https://www.instacart.com/store/wegmans/products/2748189-bananas",
      "https://www.instacart.com/store/s?k=milk",
      "https://www.target.com/p/fresh-banana-each/-/A-15013944",
      "https://www.walmart.com/ip/Fresh-Banana-Each/44390948",
    ];
    for (const url of urls) {
      expect(ADAPTERS.filter((a) => a.matches(url)).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("findAdapter", () => {
  it.each([
    ["https://www.instacart.com/store/wegmans/products/2748189-bananas", "instacart"],
    ["https://www.instacart.com/store/s?k=milk", "instacart"],
    ["https://www.target.com/p/fresh-banana-each/-/A-15013944?preselect=1", "target"],
    ["https://www.walmart.com/ip/Fresh-Banana-Each/44390948#top", "walmart"],
    ["https://www.target.com/s?searchTerm=bananas", "target"],
    ["https://www.walmart.com/search?q=bananas", "walmart"],
  ])("picks the adapter for %s", (url, name) => {
    expect(findAdapter(url)?.name).toBe(name);
  });

  it.each([
    "https://www.target.com/cart",
    "https://www.walmart.com/cp/great-value/3495493",
    "https://www.amazon.com/dp/B0000",
    "https://www.instacart.com/",
    "",
  ])("finds nothing for %s", (url) => {
    expect(findAdapter(url)).toBeUndefined();
  });

  it("skips an adapter whose matcher throws and keeps looking", () => {
    const broken: Adapter = {
      name: "target",
      version: "0.0.0",
      matches: () => {
        throw new Error("boom");
      },
      pageKind: () => undefined,
      extract: () => ({ ok: false, reason: "adapter_threw" }),
    };
    const url = "https://www.walmart.com/ip/Fresh-Banana-Each/44390948";
    expect(findAdapter(url, [broken, walmartAdapter])).toBe(walmartAdapter);
  });
});

describe("runAdapter / captureOnce with the full registry", () => {
  it("routes a Walmart URL to the Walmart adapter and a Target URL to the Target adapter", async () => {
    const deps = {
      hasConsent: async () => true,
      append: async () => 1,
      panelistId: async () => "0b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8",
      clientVersion: "0.1.0",
      now: () => new Date("2026-09-07T15:00:00.000Z"),
      uuid: () => "6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    };
    const walmart = await captureOnce(
      fragmentDocument(
        '<h1 id="main-title">Bananas</h1><span data-testid="price-wrap"><span data-seo-id="hero-price">$1.00</span></span>',
      ),
      { url: "https://www.walmart.com/ip/Bananas/44390948", surface: "web", device: "desktop" },
      deps,
    );
    expect(walmart.status === "stored" && walmart.observation.retailer).toBe("walmart");

    const target = await captureOnce(
      fragmentDocument('<h1 data-test="product-title">Bananas</h1>'),
      { url: "https://www.target.com/p/bananas/-/A-15013944", surface: "web", device: "desktop" },
      deps,
    );
    expect(target).toEqual({
      status: "extract_failed",
      adapter: "target@0.1.0",
      reason: "no_price",
    });
  });

  it("runAdapter turns a throwing extractor into adapter_threw", () => {
    const broken: Adapter = {
      name: "walmart",
      version: "0.0.0",
      matches: () => true,
      pageKind: () => "product",
      extract: () => {
        throw new Error("boom");
      },
    };
    expect(
      runAdapter(broken, fragmentDocument(""), { url: "x", surface: "web", device: "desktop" }),
    ).toEqual({ ok: false, reason: "adapter_threw", detail: "boom" });
  });
});
