/**
 * Fixture scrubber. Pure functions over an HTML string; no filesystem, no network.
 *
 * Guarantees (enforced by `checkHtml`, run in `pnpm gate`):
 *   - no <script>, <style>, <link>, <meta>, <iframe>, <svg>, <img>, <noscript>, <template>,
 *     and no HTML comments
 *   - every attribute except id, class, data-*, href, aria-*, itemprop is removed
 *   - href is reduced to its path (no origin, query, or fragment); mailto:/tel:/javascript:
 *     hrefs are dropped
 *   - text nodes and kept attribute values contain no email, phone number, 5-digit ZIP, street
 *     address, or "Hi, <Name>" style greeting; matches are replaced with [scrubbed]
 *   - a store label of the form "City, ST 12345" is reduced to "City"
 *   - any word containing a recorder-supplied name (--name) is replaced with [scrubbed]
 */
import { type DefaultTreeAdapterMap, parse, serialize } from "parse5";

type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];
type Node = DefaultTreeAdapterMap["node"] | DefaultTreeAdapterMap["document"] | ParentNode;

export const SCRUBBED = "[scrubbed]";

/** Elements removed outright, with their subtree. */
export const DROPPED_TAGS: ReadonlySet<string> = new Set([
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

/** Attributes that survive. Everything else, including inline style and event handlers, goes. */
export function isKeptAttribute(name: string): boolean {
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

/**
 * Attributes whose values are pure selector material. ZIP / phone / address rules are not
 * applied to them: a 5-digit hash inside a generated class name is not PII, and rewriting it
 * would break selectors. Names, emails and greetings are still scrubbed and checked there.
 */
const SELECTOR_ATTRIBUTES: ReadonlySet<string> = new Set(["id", "class"]);

export interface ScrubOptions {
  /** Recorder first names / usernames. Any word containing one is replaced. Never hard-coded. */
  names?: readonly string[];
}

export type ViolationRule =
  | "dropped-tag"
  | "comment"
  | "attribute"
  | "href"
  | "email"
  | "phone"
  | "zip"
  | "address"
  | "greeting"
  | "name";

export interface Violation {
  /** Which rule fired. Stable identifiers, safe to assert on in tests. */
  rule: ViolationRule;
  /** Where it was found: "text", "attr:<name>", or "tag". */
  where: string;
  /** A short excerpt of the offending value. Enough to locate it, not the whole thing. */
  sample: string;
}

// ---------------------------------------------------------------------------------------------
// PII patterns. Each is used both to scrub and to check, so the two can never disagree.
// ---------------------------------------------------------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** (609) 951-8555, 609-951-8555, 609.951.8555, 609 951 8555, +1 609-951-8555. */
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?\d{3}[\s.-]\d{4}|\b\d{3}([\s.-])\d{3}\1\d{4})\b/g;

/** 5-digit US ZIP, with optional +4. */
const ZIP = /\b\d{5}(?:-\d{4})?\b/g;

/**
 * A store label whose value ends in a full ZIP: "City, ST 12345", "City, 12345",
 * "839 US Highway 130, City, ST 12345-6789". Whole-value match only; reduced to the city,
 * which is the segment right before the state/ZIP.
 */
const STORE_LABEL_WITH_ZIP =
  /^(\s*)(?:.*?,\s*)?([A-Za-z][A-Za-z .'&-]*?)\s*,\s*(?:[A-Z]{2}\s*,?\s*)?\d{5}(?:-\d{4})?(\s*)$/;

const STREET_SUFFIXES = [
  "St",
  "Street",
  "Ave",
  "Avenue",
  "Rd",
  "Road",
  "Blvd",
  "Boulevard",
  "Dr",
  "Drive",
  "Ln",
  "Lane",
  "Way",
  "Pkwy",
  "Parkway",
  "Hwy",
  "Highway",
  "Pike",
  "Ct",
  "Court",
  "Pl",
  "Place",
  "Ter",
  "Terrace",
  "Cir",
  "Circle",
  "Tpke",
  "Turnpike",
  "Plaza",
  "Sq",
  "Square",
];
/** Title case or ALL CAPS; retailers use both ("839 US HIGHWAY 130"). Never lower case. */
const STREET_SUFFIX = STREET_SUFFIXES.flatMap((s) => [s, s.toUpperCase()]).join("|");
/** "500 Nassau Park Blvd", "1 N Main St." Requires a number, one to five words, and a suffix. */
const STREET_ADDRESS = new RegExp(
  `\\b\\d{1,6}\\s+(?:[NSEW]\\.?\\s+)?[A-Z][A-Za-z0-9.'-]*(?:\\s+[A-Z][A-Za-z0-9.'-]*){0,4}\\s+(?:${STREET_SUFFIX})\\.?(?:\\s+\\d{1,5})?(?![A-Za-z])`,
  "g",
);

/**
 * Greeting followed by a capitalised word, optionally an initial: "Hi, James", "Hello James",
 * "Welcome back, James", "Hi, James L". Name-agnostic on purpose so the gate check needs no
 * name list. Case-insensitive on the greeting only.
 */
const GREETING =
  /\b(?:[Hh]i|[Hh]ello|[Hh]ey|[Ww]elcome [Bb]ack)\b,?\s+[A-Z][a-z]+(?:\s+[A-Z]\.?)?(?![a-z])/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameRegExp(names: readonly string[]): RegExp | undefined {
  const cleaned = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (cleaned.length === 0) return undefined;
  const alternatives = cleaned.map(escapeRegExp).join("|");
  // Any word containing the name: "James", "jamesjlee04", "James's".
  return new RegExp(`[A-Za-z0-9_'.-]*(?:${alternatives})[A-Za-z0-9_'.-]*`, "gi");
}

interface Rule {
  rule: ViolationRule;
  pattern: RegExp;
  selectorSafe: boolean;
}

function textRules(opts: ScrubOptions): Rule[] {
  const rules: Rule[] = [
    { rule: "email", pattern: EMAIL, selectorSafe: true },
    { rule: "greeting", pattern: GREETING, selectorSafe: true },
    { rule: "address", pattern: STREET_ADDRESS, selectorSafe: false },
    { rule: "phone", pattern: PHONE, selectorSafe: false },
    { rule: "zip", pattern: ZIP, selectorSafe: false },
  ];
  const names = nameRegExp(opts.names ?? []);
  if (names) rules.push({ rule: "name", pattern: names, selectorSafe: true });
  return rules;
}

/** Scrub one string value (a text node or an attribute value). */
export function scrubText(value: string, opts: ScrubOptions = {}, selectorOnly = false): string {
  let out = value;
  // Store labels first, so "Princeton, NJ 08540" becomes "Princeton" rather than
  // "Princeton, NJ [scrubbed]".
  if (!selectorOnly) {
    const m = STORE_LABEL_WITH_ZIP.exec(out);
    if (m) out = `${m[1] ?? ""}${m[2] ?? ""}${m[3] ?? ""}`;
  }
  for (const r of textRules(opts)) {
    if (selectorOnly && !r.selectorSafe) continue;
    out = out.replace(r.pattern, SCRUBBED);
  }
  return out;
}

function findInText(value: string, opts: ScrubOptions, selectorOnly: boolean): Violation[] {
  const found: Violation[] = [];
  for (const r of textRules(opts)) {
    if (selectorOnly && !r.selectorSafe) continue;
    const m = value.match(r.pattern);
    const first = m?.[0];
    if (first !== undefined) {
      found.push({ rule: r.rule, where: "text", sample: excerpt(value, first) });
    }
  }
  return found;
}

function excerpt(haystack: string, needle: string): string {
  const i = haystack.indexOf(needle);
  const start = Math.max(0, i - 20);
  const end = Math.min(haystack.length, i + needle.length + 20);
  return haystack.slice(start, end).replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------------------------
// href
// ---------------------------------------------------------------------------------------------

const DROPPED_HREF_SCHEMES = /^\s*(?:mailto|tel|sms|javascript|data|blob):/i;

/** Reduce an href to its path. Returns undefined when the attribute should be dropped. */
export function pathOnly(href: string): string | undefined {
  if (DROPPED_HREF_SCHEMES.test(href)) return undefined;
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return undefined;
  try {
    // A fake base makes relative hrefs parse; we only ever read pathname.
    const u = new URL(trimmed, "https://fixture.invalid/");
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    return u.pathname;
  } catch {
    return undefined;
  }
}

/** True when an href is a bare path: starts with a single slash, no query, no fragment. */
function hrefIsClean(href: string): boolean {
  return /^\/(?:[^/?#][^?#]*)?$/.test(href);
}

// ---------------------------------------------------------------------------------------------
// Tree walk
// ---------------------------------------------------------------------------------------------

function isElement(n: Node): n is Element {
  return "tagName" in n && typeof (n as Element).tagName === "string";
}

function isParent(n: Node): n is ParentNode {
  return "childNodes" in n && Array.isArray((n as ParentNode).childNodes);
}

function scrubNode(node: Node, opts: ScrubOptions): void {
  if (isElement(node)) {
    const kept: Element["attrs"] = [];
    for (const a of node.attrs) {
      if (!isKeptAttribute(a.name)) continue;
      const lower = a.name.toLowerCase();
      if (lower === "href") {
        const p = pathOnly(a.value);
        if (p === undefined) continue;
        kept.push({ ...a, value: scrubText(p, opts) });
        continue;
      }
      kept.push({ ...a, value: scrubText(a.value, opts, SELECTOR_ATTRIBUTES.has(lower)) });
    }
    node.attrs = kept;
  }
  if (!isParent(node)) return;
  const next: DefaultTreeAdapterMap["childNode"][] = [];
  for (const child of node.childNodes) {
    if (child.nodeName === "#comment") continue;
    if (isElement(child) && DROPPED_TAGS.has(child.tagName.toLowerCase())) continue;
    if (child.nodeName === "#text" && "value" in child) {
      child.value = scrubText(child.value, opts);
    }
    scrubNode(child, opts);
    next.push(child);
  }
  node.childNodes = next;
}

/** Scrub a full HTML document. Deterministic: same input and options, same output. */
export function scrubHtml(html: string, opts: ScrubOptions = {}): string {
  const doc = parse(html);
  scrubNode(doc, opts);
  return serialize(doc);
}

function checkNode(node: Node, opts: ScrubOptions, out: Violation[]): void {
  if (node.nodeName === "#comment") {
    out.push({ rule: "comment", where: "tag", sample: "<!-- -->" });
    return;
  }
  if (isElement(node)) {
    const tag = node.tagName.toLowerCase();
    if (DROPPED_TAGS.has(tag)) {
      out.push({ rule: "dropped-tag", where: "tag", sample: `<${tag}>` });
    }
    for (const a of node.attrs) {
      const lower = a.name.toLowerCase();
      if (!isKeptAttribute(lower)) {
        out.push({ rule: "attribute", where: `attr:${lower}`, sample: `<${tag} ${lower}=…>` });
        continue;
      }
      if (lower === "href" && !hrefIsClean(a.value)) {
        out.push({ rule: "href", where: "attr:href", sample: a.value.slice(0, 80) });
      }
      for (const v of findInText(a.value, opts, SELECTOR_ATTRIBUTES.has(lower))) {
        out.push({ ...v, where: `attr:${lower}` });
      }
    }
  }
  if (node.nodeName === "#text" && "value" in node) {
    out.push(...findInText(node.value, opts, false));
  }
  if (isParent(node)) {
    for (const child of node.childNodes) checkNode(child, opts, out);
  }
}

/** Every way the document violates the scrub guarantees. Empty means clean. */
export function checkHtml(html: string, opts: ScrubOptions = {}): Violation[] {
  const out: Violation[] = [];
  checkNode(parse(html), opts, out);
  return out;
}

/** Concatenated, whitespace-normalised text of the document. Used to prove a price is present. */
export function visibleText(html: string): string {
  const parts: string[] = [];
  const walk = (n: Node): void => {
    if (n.nodeName === "#text" && "value" in n) parts.push(n.value);
    if (isParent(n)) for (const c of n.childNodes) walk(c);
  };
  walk(parse(html));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
