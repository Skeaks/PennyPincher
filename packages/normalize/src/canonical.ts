/**
 * The canonical product id. One id per real-world product across retailers:
 *
 *  - `gtin:<14 digits>` when the page showed a UPC / EAN / GTIN (method "upc", confidence 1);
 *  - the id of the best already-known product the reference fuzzily matches (method "fuzzy",
 *    confidence = the match score), when the caller supplies candidates;
 *  - a fresh `fuzzy:<tokens>@<size>` key from the normalised signature otherwise (method
 *    "fuzzy", confidence from how much identity the page gave us);
 *  - none, when the title normalises to nothing (method "none", confidence 0).
 *
 * The fresh key is deterministic, so two retailers whose titles normalise identically share
 * an id with no candidate lookup at all; candidates are what make "Great Value Whole Vitamin
 * D Milk 1 gal" and "Great Value Milk, Whole, 128 fl oz" one product.
 */
import { type MatchResult, type ProductLike, compareSignatures } from "./match";
import { sizeKey } from "./size";
import { type Signature, signature } from "./tokens";
import { normalizeUpc } from "./upc";

export type CanonicalMethod = "upc" | "fuzzy" | "none";

export interface Canonical {
  /** Null only when `method` is "none". */
  canonicalId: string | null;
  method: CanonicalMethod;
  /** 0 to 1. */
  confidence: number;
}

/** An already-canonicalised product the caller knows about (the API's products table). */
export interface KnownProduct extends ProductLike {
  canonicalId: string;
}

/** Longest a fuzzy id gets: tokens beyond this many (sorted) are dropped from the key. */
export const MAX_KEY_TOKENS = 24;

/** `fuzzy:<tokens joined by "-">@<size>`; undefined when there are no tokens. */
export function fuzzyKey(sig: Signature): string | undefined {
  if (sig.tokens.length === 0) return undefined;
  const tokens = sig.tokens.slice(0, MAX_KEY_TOKENS).join("-");
  const size = sizeKey(sig.size);
  return size ? `fuzzy:${tokens}@${size}` : `fuzzy:${tokens}`;
}

/**
 * How much identity a page gave us, with no other product to compare against. A heuristic,
 * capped below any candidate match so a real comparison always outranks a guess:
 * 0.5 for a title, +0.2 when a brand is named, +0.2 when a size is, +0.1 for three or more
 * tokens.
 */
export function standaloneConfidence(sig: Signature): number {
  let c = 0.5;
  if (sig.brandTokens.length > 0) c += 0.2;
  if (Object.keys(sig.size).length > 0) c += 0.2;
  if (sig.tokens.length >= 3) c += 0.1;
  // Two decimals: the sum of tenths is not exact in binary and the value is stored.
  return Math.round(Math.min(c, 0.9) * 100) / 100;
}

export interface CanonicalizeOptions {
  /** Products to try to attach to, in any order. The best match above threshold wins. */
  candidates?: Iterable<KnownProduct>;
  threshold?: number;
}

/**
 * Resolve a product reference to a canonical id. Pure and deterministic for a given
 * candidate set: ties between candidates fall to the lexically smaller id.
 */
export function canonicalize(product: ProductLike, options: CanonicalizeOptions = {}): Canonical {
  const upc = normalizeUpc(product.upc);
  if (upc !== undefined) return { canonicalId: `gtin:${upc}`, method: "upc", confidence: 1 };

  const sig = signature(product);
  const fresh = fuzzyKey(sig);
  if (fresh === undefined) return { canonicalId: null, method: "none", confidence: 0 };

  let best: { id: string; result: MatchResult } | undefined;
  for (const candidate of options.candidates ?? []) {
    const result = compareSignatures(sig, signature(candidate), options.threshold);
    if (!result.same) continue;
    if (
      best === undefined ||
      result.score > best.result.score ||
      (result.score === best.result.score && candidate.canonicalId < best.id)
    ) {
      best = { id: candidate.canonicalId, result };
    }
  }
  if (best !== undefined) {
    return { canonicalId: best.id, method: "fuzzy", confidence: best.result.score };
  }
  return { canonicalId: fresh, method: "fuzzy", confidence: standaloneConfidence(sig) };
}
