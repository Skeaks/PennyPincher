/**
 * The landing copy (S15): zero regulated claims (CLAUDE.md rule 10), the three ideas the
 * brief asks for (the panel, the lever probe, UNRESOLVED), and a form that matches the
 * function's contract. Read from `public/`, so the HTML is tested as shipped.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIELDS, REDIRECTS } from "../src/waitlist";

const PUBLIC = join(__dirname, "..", "public");
const PAGES = readdirSync(PUBLIC)
  .filter((f) => f.endsWith(".html"))
  .map((f) => ({ name: f, html: readFileSync(join(PUBLIC, f), "utf8") }));

const REGULATED = /\b(save|saves|saving|savings|cheapest|cheaper|lowest price|guarantee[sd]?)\b/i;
const MARKER = /<!-- claims-reviewed -->/;

function landing() {
  const page = PAGES.find((p) => p.name === "index.html");
  if (!page) throw new Error("public/index.html is missing");
  return page.html;
}

describe("landing pages", () => {
  it("ship index.html and the page the form lands on", () => {
    const names = PAGES.map((p) => p.name);
    expect(names).toContain("index.html");
    expect(names).toContain(REDIRECTS.joined.replace(/^\//, ""));
  });

  for (const page of PAGES) {
    it(`${page.name} has no regulated word without a claims-reviewed marker on the line before`, () => {
      const lines = page.html.split("\n");
      const hits = lines
        .map((line, i) => (REGULATED.test(line) && !MARKER.test(lines[i - 1] ?? "") ? i + 1 : 0))
        .filter((n) => n > 0);
      expect(hits).toEqual([]);
    });
  }

  it("explains the panel, the lever probe, and UNRESOLVED", () => {
    const html = landing();
    expect(html).toMatch(/panel/i);
    expect(html).toMatch(/lever probe/i);
    expect(html).toMatch(/UNRESOLVED/);
    expect(html).toMatch(/signed in/i);
  });

  it("says what is never read, and links the privacy policy", () => {
    const html = landing();
    expect(html).toMatch(/password/i);
    expect(html).toMatch(/cookies/i);
    expect(html).toMatch(/privacy-policy\.md/);
  });

  it("the form posts the fields the function reads, to the function, with the honeypot hidden", () => {
    const html = landing();
    expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/api\/waitlist"/i);
    expect(html).toMatch(new RegExp(`<input[^>]*type="email"[^>]*name="${FIELDS.email}"`));
    const trap = html.match(new RegExp(`<input[^>]*name="${FIELDS.honeypot}"[^>]*>`))?.[0] ?? "";
    expect(trap).toMatch(/tabindex="-1"/);
    expect(trap).toMatch(/autocomplete="off"/);
    expect(html).toMatch(/class="trap"/);
  });

  it("names what the waitlist stores, next to the form", () => {
    const html = landing();
    expect(html).toMatch(/email address and the time you joined/i);
  });
});
