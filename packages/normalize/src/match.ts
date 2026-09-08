/**
 * Pairwise identity: are these two product references the same product?
 *
 * UPC first. Two valid codes that agree are the same product; two that disagree are not,
 * whatever the titles say. Otherwise fuzzy: the token-set similarity (Dice coefficient) of
 * brand + title, gated by three hard conflicts that a similarity score would paper over:
 *
 *  - size:    a dimension both sides carry disagrees (64 oz vs 128 oz), or one side is a
 *             multipack and the other an unlabelled single;
 *  - brand:   both pages named a brand and the brands share no token;
 *  - variant: an attribute word (organic, frozen, 2%, ...) appears on one side only.
 *
 * The threshold is tuned on the golden set (`__golden__/pairs.json`) for precision on "same"
 * at or above 0.97; recall is what it is and is reported by the harness, never gated.
 */
import { type SizeAgreement, compareSizes } from "./size";
import { type Signature, type SignatureInput, VARIANT_ATTRIBUTES, signature } from "./tokens";
import { normalizeUpc } from "./upc";

/** Dice similarity at or above which two token sets are the same product. */
export const FUZZY_THRESHOLD = 0.8;

export type MatchMethod = "upc" | "fuzzy";

export type MatchReason =
  | "upc_conflict"
  | "no_tokens"
  | "size_conflict"
  | "brand_conflict"
  | "variant_conflict"
  | "below_threshold";

export interface MatchResult {
  same: boolean;
  /** "upc" when both sides carried a valid code; "fuzzy" otherwise. */
  method: MatchMethod;
  /** 1 for a UPC decision; the Dice similarity for a fuzzy one, even when a gate fired. */
  score: number;
  sizes: SizeAgreement;
  /** Why the pair is not the same, when it is not. */
  reason?: MatchReason;
}

/** The fields of a `ProductRef` that identity reads. */
export interface ProductLike extends SignatureInput {
  upc?: string | undefined;
}

/** Dice coefficient over two token sets: 2|A and B| / (|A| + |B|). 1 when both are empty. */
export function tokenSetSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setB = new Set(b);
  let shared = 0;
  for (const t of new Set(a)) if (setB.has(t)) shared += 1;
  return (2 * shared) / (new Set(a).size + setB.size);
}

/** The variant attributes present on exactly one side. */
function variantDifference(a: readonly string[], b: readonly string[]): string[] {
  const setA = new Set(a);
  const setB = new Set(b);
  const out: string[] = [];
  for (const t of setA) if (VARIANT_ATTRIBUTES.has(t) && !setB.has(t)) out.push(t);
  for (const t of setB) if (VARIANT_ATTRIBUTES.has(t) && !setA.has(t)) out.push(t);
  return out;
}

function brandsConflict(a: Signature, b: Signature): boolean {
  if (a.brandTokens.length === 0 || b.brandTokens.length === 0) return false;
  const setB = new Set(b.brandTokens);
  return !a.brandTokens.some((t) => setB.has(t));
}

/** Fuzzy comparison of two signatures. */
export function compareSignatures(
  a: Signature,
  b: Signature,
  threshold = FUZZY_THRESHOLD,
): MatchResult {
  const sizes = compareSizes(a.size, b.size);
  const score = tokenSetSimilarity(a.tokens, b.tokens);
  const base = { method: "fuzzy" as const, score, sizes };
  if (a.tokens.length === 0 || b.tokens.length === 0) {
    return { ...base, same: false, reason: "no_tokens" };
  }
  if (sizes === "conflict") return { ...base, same: false, reason: "size_conflict" };
  if (brandsConflict(a, b)) return { ...base, same: false, reason: "brand_conflict" };
  if (variantDifference(a.tokens, b.tokens).length > 0) {
    return { ...base, same: false, reason: "variant_conflict" };
  }
  if (score < threshold) return { ...base, same: false, reason: "below_threshold" };
  return { ...base, same: true };
}

/** Same product? UPC when both have a valid one, fuzzy otherwise. */
export function matchProducts(
  a: ProductLike,
  b: ProductLike,
  threshold = FUZZY_THRESHOLD,
): MatchResult {
  const upcA = normalizeUpc(a.upc);
  const upcB = normalizeUpc(b.upc);
  if (upcA !== undefined && upcB !== undefined) {
    const same = upcA === upcB;
    return same
      ? { same, method: "upc", score: 1, sizes: "unknown" }
      : { same, method: "upc", score: 0, sizes: "unknown", reason: "upc_conflict" };
  }
  return compareSignatures(signature(a), signature(b), threshold);
}
