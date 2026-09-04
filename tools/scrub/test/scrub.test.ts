import { describe, expect, it } from "vitest";
import { outputPathFor, parseArgs } from "../src/cli.js";
import {
  SCRUBBED,
  type ViolationRule,
  checkHtml,
  pathOnly,
  scrubHtml,
  scrubText,
  visibleText,
} from "../src/scrub.js";

/** A synthetic page with every kind of thing the scrubber must remove. No real data. */
const RAW = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Bananas - each - Example</title>
<link rel="stylesheet" href="https://cdn.example.com/app.css">
<style>.x{color:red}</style>
<script id="__STATE__" type="application/json">{"customer":{"email":"person@example.com","zip":"12345"}}</script>
</head><body>
<!-- rendered by build 12345 -->
<header>
  <a href="https://www.example.com/account?token=abc#top" aria-label="Hi, Alexandra, 2 notifications" style="color:red" onclick="track()">
    <span class="display-name">Alexandra</span>
  </a>
  <div class="store" data-qm-mask="true">Springfield, IL 62701</div>
  <div class="store-address">742 Evergreen Terrace, Springfield, IL 62701</div>
  <button aria-label="Ship to location: 62701">Ship to 62701</button>
  <p>Questions? Call (217) 555-0134 or 217-555-0134 or email help@example.com.</p>
  <p>Store at 500 N Main St. opens 9am.</p>
  <img src="https://cdn.example.com/hero.jpg" alt="hero">
  <svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>
  <iframe src="https://ads.example.com/frame"></iframe>
  <noscript><img src="https://t.example.com/pixel.gif"></noscript>
  <template><div>hidden</div></template>
</header>
<main>
  <h1 data-test="product-title" id="pdp-title" itemprop="name">Fresh Banana - each - Good &amp; Gather™</h1>
  <span data-test="product-price" class="price sc-12345 e-1f733bp" id="p-90210">$0.29</span>
  <a href="/p/banana/-/A-15013944?preselect=1">Details</a>
  <a href="mailto:help@example.com">Email us</a>
  <a href="tel:+12175550134">Call us</a>
  <a href="javascript:void(0)">Nope</a>
  <p>Average rating 4.3 with 12345 reviews. Item 15013944. Weight 16 oz. Buy 2 Way Radio.</p>
</main>
</body></html>`;

describe("scrubHtml structure", () => {
  const out = scrubHtml(RAW, { names: ["Alexandra"] });

  it("drops script, style, link, meta, iframe, svg, img, noscript, template, comments", () => {
    for (const tag of ["script", "style", "link", "meta", "iframe", "svg", "img", "noscript"]) {
      expect(out, tag).not.toMatch(new RegExp(`<${tag}[\\s>]`, "i"));
    }
    expect(out).not.toMatch(/<template/i);
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("__STATE__");
    expect(out).not.toContain("hidden");
  });

  it("keeps only id, class, data-*, href, aria-*, itemprop", () => {
    expect(out).not.toMatch(/\sstyle=/);
    expect(out).not.toMatch(/\sonclick=/);
    expect(out).not.toMatch(/\salt=/);
    expect(out).not.toMatch(/\slang=/);
    expect(out).not.toMatch(/\stype=/);
    expect(out).toContain('data-test="product-title"');
    expect(out).toContain('id="pdp-title"');
    expect(out).toContain('itemprop="name"');
    expect(out).toContain('class="price sc-12345 e-1f733bp"');
  });

  it("reduces href to path only and drops mailto/tel/javascript hrefs", () => {
    expect(out).toContain('href="/account"');
    expect(out).toContain('href="/p/banana/-/A-15013944"');
    expect(out).not.toContain("token=abc");
    expect(out).not.toContain("mailto:");
    expect(out).not.toContain("tel:");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("example.com");
  });

  it("keeps the title element and the price, which tests depend on", () => {
    expect(out).toContain("<title>Bananas - each - Example</title>");
    expect(out).toContain('data-test="product-price"');
    expect(visibleText(out)).toContain("$0.29");
    expect(visibleText(out)).toContain("Fresh Banana - each - Good & Gather™");
  });

  it("is idempotent", () => {
    expect(scrubHtml(out, { names: ["Alexandra"] })).toBe(out);
  });

  it("produces output that passes checkHtml", () => {
    expect(checkHtml(out, { names: ["Alexandra"] })).toEqual([]);
  });
});

describe("scrubHtml PII", () => {
  const out = scrubHtml(RAW, { names: ["Alexandra"] });
  const text = visibleText(out);

  it("replaces emails, phones and ZIPs in text nodes", () => {
    expect(text).not.toContain("help@example.com");
    expect(text).not.toContain("555-0134");
    expect(text).not.toContain("62701");
    expect(text).toContain(`Call ${SCRUBBED} or ${SCRUBBED} or email ${SCRUBBED}.`);
    expect(text).toContain(`Ship to ${SCRUBBED}`);
  });

  it("replaces street addresses", () => {
    expect(text).not.toContain("500 N Main St");
    expect(text).toContain(`Store at ${SCRUBBED} opens 9am.`);
  });

  it("reduces a store label with a ZIP to its city, including address lines", () => {
    expect(out).toContain('<div class="store" data-qm-mask="true">Springfield</div>');
    expect(out).toContain('<div class="store-address">Springfield</div>');
    expect(out).not.toContain("Evergreen");
  });

  it("replaces greetings and bare names, in text and aria-* alike", () => {
    expect(out).not.toContain("Alexandra");
    expect(out).toContain(`aria-label="${SCRUBBED}, 2 notifications"`);
    expect(out).toContain(`<span class="display-name">${SCRUBBED}</span>`);
  });

  it("scrubs a 5-digit review count too (a ZIP is indistinguishable from it)", () => {
    expect(text).toContain(`with ${SCRUBBED} reviews`);
  });

  it("leaves SKUs, sizes, 5-digit tokens in class/id, and product words alone", () => {
    expect(text).toContain("Item 15013944");
    expect(text).toContain("16 oz");
    expect(text).toContain("Buy 2 Way Radio");
    expect(out).toContain("sc-12345");
    expect(out).toContain('id="p-90210"');
  });
});

describe("scrubText", () => {
  it("handles greetings without a name list", () => {
    expect(scrubText("Hi, James")).toBe(SCRUBBED);
    expect(scrubText("Hello James")).toBe(SCRUBBED);
    expect(scrubText("Welcome back, James")).toBe(SCRUBBED);
    expect(scrubText("Hi, James L")).toBe(SCRUBBED);
    expect(scrubText("hi James, 1 notification")).toBe(`${SCRUBBED}, 1 notification`);
  });

  it("does not treat 'hi' inside a word or a lower-case word after it as a greeting", () => {
    expect(scrubText("This banana is high quality")).toBe("This banana is high quality");
    expect(scrubText("Say hi to bananas")).toBe("Say hi to bananas");
    expect(scrubText("Welcome to Target")).toBe("Welcome to Target");
  });

  it("replaces any word containing a supplied name, case-insensitively", () => {
    const opts = { names: ["James", "jamesjlee04"] };
    expect(scrubText("Signed in as jamesjlee04", opts)).toBe(`Signed in as ${SCRUBBED}`);
    expect(scrubText("James's list", opts)).toBe(`${SCRUBBED} list`);
    expect(scrubText("JAMES", opts)).toBe(SCRUBBED);
    expect(scrubText("no names here", opts)).toBe("no names here");
  });

  it("ignores empty names", () => {
    expect(scrubText("Hello world", { names: ["", "  "] })).toBe("Hello world");
  });

  it("reduces store labels in all the shapes seen on real pages", () => {
    expect(scrubText("Princeton, NJ 08540")).toBe("Princeton");
    expect(scrubText("Princeton, 08540")).toBe("Princeton");
    expect(scrubText(" Princeton, NJ 08540")).toBe(" Princeton");
    expect(scrubText("East Windsor, NJ 08520-1234")).toBe("East Windsor");
    expect(scrubText("839 US HIGHWAY 130, East Windsor, NJ 08520")).toBe("East Windsor");
  });

  it("scrubs ALL CAPS street addresses", () => {
    expect(scrubText("839 US HIGHWAY 130")).toBe(SCRUBBED);
    expect(scrubText("500 Nassau Park Blvd")).toBe(SCRUBBED);
  });

  it("keeps SVG-like number runs that are not phone numbers", () => {
    expect(scrubText("156 112.0709")).toBe("156 112.0709");
    expect(scrubText("125 562 7940 88")).toBe(`${SCRUBBED} 88`);
  });
});

describe("checkHtml", () => {
  function rules(html: string, names: string[] = []): Set<ViolationRule> {
    return new Set(checkHtml(html, { names }).map((v) => v.rule));
  }

  it("flags every rule on the raw synthetic page", () => {
    const found = rules(RAW, ["Alexandra"]);
    for (const rule of [
      "dropped-tag",
      "comment",
      "attribute",
      "href",
      "email",
      "phone",
      "zip",
      "address",
      "greeting",
      "name",
    ] as const) {
      expect(found.has(rule), rule).toBe(true);
    }
  });

  it("flags a greeting without needing the name list", () => {
    expect(rules("<p>Hi, Somebody</p>")).toEqual(new Set(["greeting"]));
    expect(rules('<a aria-label="Hello Somebody">x</a>')).toEqual(new Set(["greeting"]));
  });

  it("flags a ZIP or phone hiding in a data-* attribute", () => {
    expect(rules('<div data-props="{&quot;zip&quot;:&quot;08540&quot;}"></div>')).toEqual(
      new Set(["zip"]),
    );
    expect(rules('<div data-phone="609-951-8555"></div>')).toEqual(new Set(["phone"]));
  });

  it("does not flag 5-digit tokens inside class or id", () => {
    expect(rules('<div class="sc-12345 x" id="node-90210"></div>')).toEqual(new Set());
  });

  it("flags an href that kept a query, fragment, or origin", () => {
    expect(rules('<a href="/p?x=1">a</a>')).toEqual(new Set(["href"]));
    expect(rules('<a href="/p#top">a</a>')).toEqual(new Set(["href"]));
    expect(rules('<a href="https://example.com/p">a</a>')).toEqual(new Set(["href"]));
    expect(rules('<a href="/p/banana/-/A-1">a</a>')).toEqual(new Set());
  });

  it("flags the name list when given, case-insensitively and inside words", () => {
    expect(rules("<p>jamesjlee04</p>", ["James"])).toEqual(new Set(["name"]));
    expect(rules("<p>jamesjlee04</p>")).toEqual(new Set());
  });
});

describe("pathOnly", () => {
  it("keeps the path of absolute and relative URLs", () => {
    expect(pathOnly("https://www.target.com/p/x/-/A-1?preselect=2#tab")).toBe("/p/x/-/A-1");
    expect(pathOnly("/store/wegmans?x=1")).toBe("/store/wegmans");
    expect(pathOnly("products/1?y")).toBe("/products/1");
    expect(pathOnly("//cdn.example.com/a/b")).toBe("/a/b");
  });

  it("drops fragments-only, empty, and non-http hrefs", () => {
    expect(pathOnly("#top")).toBeUndefined();
    expect(pathOnly("")).toBeUndefined();
    expect(pathOnly("mailto:a@b.co")).toBeUndefined();
    expect(pathOnly("tel:5551234")).toBeUndefined();
    expect(pathOnly("javascript:void(0)")).toBeUndefined();
    expect(pathOnly("data:text/html,hi")).toBeUndefined();
  });
});

describe("cli", () => {
  it("parses paths, --check, and repeated --name", () => {
    expect(parseArgs(["a.html", "--name", "James", "b.html", "--name=Lee"])).toEqual({
      check: false,
      help: false,
      names: ["James", "Lee"],
      paths: ["a.html", "b.html"],
    });
    expect(parseArgs(["--check", "fixtures/target"])).toMatchObject({
      check: true,
      paths: ["fixtures/target"],
    });
  });

  it("rejects unknown flags and a dangling --name", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown flag/);
    expect(() => parseArgs(["--name"])).toThrow(/needs a value/);
  });

  it("maps fixtures/raw/<retailer>/<slug>.html to fixtures/<retailer>/<slug>.html", () => {
    const out = outputPathFor("/repo/fixtures/raw/instacart/bananas.html", "/repo/fixtures");
    expect(out.replace(/\\/g, "/")).toBe("/repo/fixtures/instacart/bananas.html");
  });
});
