# @pennypincher/normalize

Product identity (S13). The same banana is `2748189` on Instacart, `15013944` at Target and
`44390948` at Walmart; a cross-retailer ladder needs one id.

## API

```ts
import { canonicalize, matchProducts } from "@pennypincher/normalize";

canonicalize(product);                      // { canonicalId, method: "upc" | "fuzzy" | "none", confidence }
canonicalize(product, { candidates });      // attach to the best known product above threshold
matchProducts(a, b);                        // { same, method, score, sizes, reason? }
```

- **UPC.** `normalizeUpc` takes 8, 12, 13 or 14 digits, expands UPC-E, checks the GS1 mod-10
  digit and pads to GTIN-14. A code that fails the check is treated as absent: a wrong code
  merges two products, no code merely misses one. Id: `gtin:<14 digits>`, confidence 1.
- **Fuzzy.** `signature()` turns brand + title + sizeText into a sorted token set (lower case,
  marks and punctuation out, stopwords out, light plural fold, `2%` spelled `2pct`) and a size
  in canonical units (`ml`, `g`, `ct`; fl oz, gal, qt, pt, l / oz, lb, kg / ct, pack of N, N
  pack, each). `matchProducts` is the Dice similarity of the token sets, gated by hard
  conflicts: a shared size dimension that disagrees (a missing count is 1), two explicit
  brands with no token in common, or a variant attribute (organic, frozen, 2%, strawberry,
  ...) on one side only. `FUZZY_THRESHOLD` is 0.8. Id: `fuzzy:<tokens>@<size>` when nothing
  is known, or the matched candidate's id; confidence is the match score, or a heuristic
  (0.5 to 0.9) for a fresh id.
- **None.** A title that normalises to nothing. Id `null`, confidence 0.

## The golden set

`__golden__/pairs.json` is 100 hand-labelled same/different pairs across the three
retailers, drawn from the fixture product pages and search tiles (`source: "fixture:..."`)
plus composed variants of them (`source: "composed"`: a unit conversion, a reordering, a UPC).
`test/golden.test.ts` gates precision on "same" at 0.97 and prints recall.

The file is human-owned (CLAUDE.md rule 3). The S13 session proposed the labels
(`status: "proposed"`); Jamie reviews by editing `label` (and `note`) and setting `status` to
`"reviewed"`. If the harness fails after a relabel, the matcher is wrong, not the label.
Pairs the session was least sure of say so in their `note`.

## Where it is used

`apps/api` resolves an id per observation at ingest (`repo/products.ts`): the products table
is keyed by `canonicalId`, every observation row stores `canonical_id`, and
`canonical_cell_key` = `canonicalId|fulfillment|zip3` is the cross-retailer cell.
