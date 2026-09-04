import { describe, expect, it } from "vitest";
import {
  SCRUBBED,
  evidenceHash,
  evidenceHtml,
  scrubClone,
  scrubText,
} from "../../src/capture/evidence";
import { sha256Hex } from "../../src/capture/sha256";
import { fragmentDocument, listFixtures, parseDocument } from "./dom";

describe("scrubText", () => {
  it("replaces email, phone, ZIP and greeting", () => {
    expect(scrubText("mail a@b.co now")).toBe(`mail ${SCRUBBED} now`);
    expect(scrubText("call (609) 951-8555")).toBe(`call ${SCRUBBED}`);
    expect(scrubText("ship to 08540-1234")).toBe(`ship to ${SCRUBBED}`);
    expect(scrubText("Hi, James L!")).toBe(`${SCRUBBED}!`);
  });

  it("leaves 5-digit hashes alone in selector material", () => {
    expect(scrubText("e-12345 col-08540", true)).toBe("e-12345 col-08540");
    expect(scrubText("hi-James", true)).toBe("hi-James");
  });
});

describe("scrubClone", () => {
  it("drops scripts, styles, images, comments and every non-allowlisted attribute", () => {
    const doc = fragmentDocument(
      '<div id="price" class="e-1" style="color:red" onclick="x()" data-testid="p" aria-hidden="false">' +
        "<script>alert(1)</script><style>.x{}</style><img src=x.png><!-- c -->" +
        '<a href="https://www.instacart.com/store/x?y=1#z" target="_blank">link</a>' +
        '<a href="mailto:a@b.co">mail</a>' +
        "<span>Hi, James, your ZIP 08540 and 609-951-8555</span></div>",
    );
    const el = doc.querySelector("#price");
    expect(el).not.toBeNull();
    if (!el) return;
    const html = evidenceHtml(el);
    const expected = [
      '<div id="price" class="e-1" data-testid="p" aria-hidden="false">',
      '<a href="/store/x">link</a><a>mail</a>',
      `<span>${SCRUBBED}, your ZIP ${SCRUBBED} and ${SCRUBBED}</span></div>`,
    ].join("");
    expect(html).toBe(expected);
    // The original is untouched.
    expect(el.querySelector("script")).not.toBeNull();
    expect(el.getAttribute("style")).toBe("color:red");
    expect(scrubClone(el)).not.toBe(el);
  });

  it("is a fixed point on already-scrubbed fixture markup", () => {
    for (const f of listFixtures("instacart")) {
      const doc = parseDocument(f.html);
      const details = doc.querySelector("#item_details");
      expect(details).not.toBeNull();
      if (!details) continue;
      expect(evidenceHtml(details)).toBe(details.outerHTML);
    }
  });
});

describe("evidenceHash", () => {
  it("is the SHA-256 hex of the scrubbed outerHTML", () => {
    const doc = fragmentDocument('<div id="p" style="x"><span>$0.22</span></div>');
    const el = doc.querySelector("#p");
    if (!el) throw new Error("no element");
    expect(evidenceHash(el)).toBe(sha256Hex('<div id="p"><span>$0.22</span></div>'));
    expect(evidenceHash(el)).toMatch(/^[a-f0-9]{64}$/);
  });
});
