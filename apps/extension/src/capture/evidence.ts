/**
 * Evidence hash: SHA-256 of the scrubbed outerHTML of the element the price was read from.
 * Lets a parse be re-checked later without the page, and ties an observation to a rendering.
 *
 * The scrub rules are the same set `tools/scrub` applies to fixtures (dropped tags, kept
 * attributes, href-to-path, email / phone / ZIP / greeting patterns). They are restated here
 * over the live DOM rather than imported: the fixture scrubber is a Node tool built on parse5,
 * and a content script has the real DOM and no business bundling a parser. Because the rules
 * agree, scrubbing an already-scrubbed fixture element is a no-op, which
 * test/capture/evidence.test.ts pins, and the hash an adapter computes on a fixture equals the
 * hash it would have computed on the live page the fixture came from.
 */
import { sha256Hex } from "./sha256";

export const SCRUBBED = "[scrubbed]";

const DROPPED_TAGS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "link",
  "meta",
  "iframe",
  "svg",
  "img",
  "noscript",
  "template",
]);

function isKeptAttribute(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === "id" ||
    n === "class" ||
    n === "href" ||
    n === "itemprop" ||
    n.startsWith("data-") ||
    n.startsWith("aria-")
  );
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\b\d{3}([\s.-])\d{3}\1\d{4})\b/g;
const ZIP = /\b\d{5}(?:-\d{4})?\b/g;
const GREETING =
  /\b(?:[Hh]i|[Hh]ello|[Hh]ey|[Ww]elcome [Bb]ack)\b,?\s+[A-Z][a-z]+(?:\s+[A-Z]\.?)?(?![a-z])/g;

/** id and class are selector material: only the patterns that cannot hit a hash apply. */
const SELECTOR_SAFE: readonly RegExp[] = [EMAIL, GREETING];
const ALL: readonly RegExp[] = [EMAIL, GREETING, PHONE, ZIP];

export function scrubText(value: string, selectorOnly = false): string {
  let out = value;
  for (const pattern of selectorOnly ? SELECTOR_SAFE : ALL) out = out.replace(pattern, SCRUBBED);
  return out;
}

const DROPPED_HREF_SCHEMES = /^\s*(?:mailto|tel|sms|javascript|data|blob):/i;

function pathOnly(href: string): string | undefined {
  if (DROPPED_HREF_SCHEMES.test(href)) return undefined;
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return undefined;
  try {
    const u = new URL(trimmed, "https://fixture.invalid/");
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    return u.pathname;
  } catch {
    return undefined;
  }
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

function scrubInPlace(node: Node): void {
  if (node.nodeType === ELEMENT_NODE) {
    const el = node as Element;
    for (const name of Array.from(el.getAttributeNames())) {
      const value = el.getAttribute(name) ?? "";
      if (!isKeptAttribute(name)) {
        el.removeAttribute(name);
        continue;
      }
      const lower = name.toLowerCase();
      if (lower === "href") {
        const p = pathOnly(value);
        if (p === undefined) el.removeAttribute(name);
        else el.setAttribute(name, scrubText(p));
        continue;
      }
      el.setAttribute(name, scrubText(value, lower === "id" || lower === "class"));
    }
  }
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === COMMENT_NODE) {
      child.remove();
      continue;
    }
    if (
      child.nodeType === ELEMENT_NODE &&
      DROPPED_TAGS.has((child as Element).tagName.toLowerCase())
    ) {
      child.remove();
      continue;
    }
    if (child.nodeType === TEXT_NODE) {
      child.textContent = scrubText(child.textContent ?? "");
    }
    scrubInPlace(child);
  }
}

/** A scrubbed deep copy of `el`. The original is untouched. */
export function scrubClone(el: Element): Element {
  const clone = el.cloneNode(true) as Element;
  scrubInPlace(clone);
  return clone;
}

/** The scrubbed outerHTML an evidence hash is computed over. Exposed so tests can re-derive it. */
export function evidenceHtml(el: Element): string {
  return scrubClone(el).outerHTML;
}

export function evidenceHash(el: Element): string {
  return sha256Hex(evidenceHtml(el));
}
