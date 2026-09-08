/**
 * Text normalisation for fuzzy identity. A product's tokens are its brand and title, lower
 * cased, with trademark marks, punctuation, size expressions and stopwords removed and a light
 * plural fold ("bananas" and "banana" are one token). Order is discarded: "Great Value Whole
 * Vitamin D Milk" and "Great Value Vitamin D Whole Milk" are the same set.
 */
import { type Size, mergeSizes, parseSize } from "./size";

/** Words that carry no identity. Kept short on purpose; every entry is a recall trade. */
const STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "of",
  "and",
  "or",
  "with",
  "by",
  "for",
  "in",
  "to",
  "per",
  "on",
  "at",
  "from",
  "sold",
]);

/**
 * Variant attributes: a token from this list present on one side only means a different
 * product even when everything else agrees ("Whole Milk" vs "Organic Whole Milk", "Bananas"
 * vs "Frozen Sliced Bananas", "Smoothie Super Berry" vs "Smoothie Strawberry Banana").
 * Three families: form (how the food is processed), nutrition (what was added or removed;
 * milk fat is written as a percentage, and "2%" tokenises to "2pct") and flavour. A word here
 * only ever splits a pair, never joins one, so a wrong entry costs recall, not precision.
 */
export const VARIANT_ATTRIBUTES: ReadonlySet<string> = new Set([
  // form
  "organic",
  "frozen",
  "dried",
  "freeze",
  "dehydrated",
  "sliced",
  "whole",
  "puree",
  "powder",
  "plantain",
  "mini",
  "baby",
  "seedless",
  "ultra",
  "filtered",
  // nutrition
  "skim",
  "nonfat",
  "1pct",
  "2pct",
  "lactose",
  "lacfree",
  "unsweetened",
  "sweetened",
  "decaf",
  "diet",
  "zero",
  "light",
  "lite",
  "reduced",
  "low",
  "enriched",
  "fortified",
  "calcium",
  "protein",
  "omega",
  "dha",
  // flavour
  "chocolate",
  "vanilla",
  "strawberry",
  "berry",
  "blueberry",
  "raspberry",
  "cherry",
  "cinnamon",
  "apple",
  "peach",
  "mango",
  "lemon",
  "grape",
  "pistachio",
  "caramel",
  "kale",
]);

const MARKS = /[™®©]/g;

/** Fold a word to its singular-ish stem. Deliberately light: only a trailing "s". */
function stem(word: string): string {
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Tokenise free text: NFKD, lower case, marks and punctuation out, "%" spelled "pct" so the
 * token survives in an id, digits kept (they distinguish "1st Foods" and "Stage 2").
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  // Marks go first: NFKD would spell "™" as "TM" and make it a token.
  const cleaned = text
    .replace(MARKS, " ")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/%/g, "pct")
    .replace(/[^a-z0-9]+/g, " ");
  for (const raw of cleaned.split(" ")) {
    if (raw.length === 0 || STOPWORDS.has(raw)) continue;
    const word = stem(raw);
    if (word.length === 0) continue;
    out.push(word);
  }
  return out;
}

/** What fuzzy identity works from: the token set and the size, read from a product. */
export interface Signature {
  /** Sorted, deduplicated tokens of brand + title with size expressions removed. */
  tokens: string[];
  size: Size;
  /** Tokens of the explicit `brand` field alone; empty when the page showed none. */
  brandTokens: string[];
}

/** The fields of a `ProductRef` the signature reads. */
export interface SignatureInput {
  title: string;
  brand?: string | undefined;
  sizeText?: string | undefined;
}

/** Build the signature: explicit size text first, then the size expressions in the title. */
export function signature(input: SignatureInput): Signature {
  const fromSizeText = input.sizeText ? parseSize(input.sizeText) : undefined;
  const fromTitle = parseSize(input.title);
  const size = mergeSizes(fromSizeText?.size ?? {}, fromTitle.size);
  const brandTokens = input.brand ? tokenize(input.brand) : [];
  const tokens = new Set<string>([...brandTokens, ...tokenize(fromTitle.rest)]);
  return { tokens: [...tokens].sort(), size, brandTokens };
}
