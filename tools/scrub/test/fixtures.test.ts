/**
 * The gate check. Every committed fixture must pass the scrub guarantees and carry a valid,
 * consistent sidecar. This is `pnpm scrub --check`, run by vitest so CI cannot skip it.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkFixture, checkFixtureDir, listFixturePages } from "../src/check.js";
import { repoRoot } from "../src/cli.js";

const FIXTURES = join(repoRoot(), "fixtures");
const RETAILERS = ["instacart", "target", "walmart"] as const;

describe("committed fixtures", () => {
  it("all pass the scrub guarantees and sidecar checks", () => {
    const failures = checkFixtureDir(FIXTURES);
    const report = failures
      .map((f) => `${f.file}\n${f.problems.map((p) => `  - ${p}`).join("\n")}`)
      .join("\n");
    expect(failures, report).toEqual([]);
  });

  it.each(RETAILERS)("%s has at least 3 logged-in and 1 logged-out product page", (retailer) => {
    const pages = readdirSync(join(FIXTURES, retailer)).filter((f) => f.endsWith(".html"));
    const loggedOut = pages.filter((f) => f.endsWith("-logged-out.html"));
    const loggedIn = pages.filter((f) => !f.endsWith("-logged-out.html"));
    expect(loggedIn.length, `logged-in pages: ${loggedIn.join(", ")}`).toBeGreaterThanOrEqual(3);
    expect(loggedOut.length, `logged-out pages: ${loggedOut.join(", ")}`).toBeGreaterThanOrEqual(1);
  });

  it("never lists raw captures", () => {
    for (const p of listFixturePages(FIXTURES)) {
      expect(p.replace(/\\/g, "/")).not.toContain("/raw/");
    }
  });
});

describe("checkFixture on synthetic problems", () => {
  const dir = mkdtempSync(join(tmpdir(), "pp-scrub-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const GOOD_META = {
    retailer: "target",
    capturedAt: "2026-09-04T15:26:18Z",
    fulfillment: "pickup",
    sessionState: "logged_in",
    zip3: "085",
    store: { retailerStoreId: "1872", label: "Durham" },
    expected: {
      price: { amountMinor: 29, currency: "USD" },
      priceText: "$0.29",
      title: "Fresh Banana - each",
      retailerSku: "15013944",
    },
  };

  function write(slug: string, html: string, meta: unknown): string {
    const sub = join(dir, "target");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, `${slug}.html`), html);
    if (meta !== undefined) {
      writeFileSync(join(sub, `${slug}.meta.json`), JSON.stringify(meta));
    }
    return join(sub, `${slug}.html`);
  }

  it("passes a clean page with a filled sidecar", () => {
    const p = write(
      "clean",
      '<html><body><h1>Fresh Banana - each</h1><span data-test="product-price">$0.29</span></body></html>',
      GOOD_META,
    );
    expect(checkFixture(p)).toEqual([]);
  });

  it("fails a page captured before the price rendered", () => {
    const p = write(
      "no-price",
      '<html><body><h1>Fresh Banana - each</h1><div data-test="product-price"></div></body></html>',
      GOOD_META,
    );
    expect(checkFixture(p)).toEqual([
      expect.stringContaining('expected price text "$0.29" not present'),
    ]);
  });

  it("fails a page whose sidecar is missing or still a template", () => {
    const missing = write(
      "no-meta",
      "<html><body>$0.29 Fresh Banana - each</body></html>",
      undefined,
    );
    expect(checkFixture(missing)).toEqual([expect.stringContaining("missing sidecar")]);

    const template = write("template", "<html><body>$0.29 Fresh Banana - each</body></html>", {
      ...GOOD_META,
      zip3: "TODO",
      capturedAt: "TODO",
    });
    const problems = checkFixture(template);
    expect(problems.some((p) => p.includes("zip3"))).toBe(true);
    expect(problems.some((p) => p.includes("capturedAt"))).toBe(true);
  });

  it("fails when the slug and sessionState disagree", () => {
    const p = write("pair-logged-out", "<html><body>$0.29 Fresh Banana - each</body></html>", {
      ...GOOD_META,
      sessionState: "logged_in",
    });
    expect(checkFixture(p)).toEqual([expect.stringContaining("disagree")]);
  });

  it("fails when priceText and amountMinor disagree, or the store label carries a ZIP", () => {
    const p = write("bad-money", "<html><body>$0.29 Fresh Banana - each</body></html>", {
      ...GOOD_META,
      store: { retailerStoreId: "1872", label: "Durham, NC 27707" },
      expected: { ...GOOD_META.expected, price: { amountMinor: 39, currency: "USD" } },
    });
    const problems = checkFixture(p);
    expect(problems.some((x) => x.includes("amountMinor is 39"))).toBe(true);
    expect(problems.some((x) => x.includes("contains a full ZIP"))).toBe(true);
  });

  it("fails a page that still carries PII or scripts", () => {
    const p = write(
      "leaky",
      '<html><body><script>1</script><p aria-label="Hi, Somebody">$0.29 Fresh Banana - each 08540</p></body></html>',
      GOOD_META,
    );
    const problems = checkFixture(p);
    expect(problems.some((x) => x.startsWith("dropped-tag"))).toBe(true);
    expect(problems.some((x) => x.startsWith("greeting"))).toBe(true);
    expect(problems.some((x) => x.startsWith("zip"))).toBe(true);
  });
});
