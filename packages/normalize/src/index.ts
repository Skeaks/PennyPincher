/**
 * @pennypincher/normalize — product identity (S13).
 *
 * The same banana is `2748189` on Instacart, `15013944` at Target and `44390948` at Walmart.
 * Cross-retailer ladders need one id. `canonicalize()` gives it: GTIN-14 when the page showed
 * a UPC, otherwise a fuzzy identity from brand + title + size. `matchProducts()` is the
 * pairwise question the golden set measures.
 */
export {
  type Canonical,
  type CanonicalizeOptions,
  type CanonicalMethod,
  type KnownProduct,
  MAX_KEY_TOKENS,
  canonicalize,
  fuzzyKey,
  standaloneConfidence,
} from "./canonical";
export {
  FUZZY_THRESHOLD,
  type MatchMethod,
  type MatchReason,
  type MatchResult,
  type ProductLike,
  compareSignatures,
  matchProducts,
  tokenSetSimilarity,
} from "./match";
export {
  type Dimension,
  SIZE_TOLERANCE,
  type Size,
  type SizeAgreement,
  type SizeParse,
  compareSizes,
  mergeSizes,
  parseSize,
  sizeKey,
} from "./size";
export {
  type Signature,
  type SignatureInput,
  VARIANT_ATTRIBUTES,
  signature,
  tokenize,
} from "./tokens";
export { expandUpcE, gs1CheckDigit, hasValidCheckDigit, normalizeUpc } from "./upc";
