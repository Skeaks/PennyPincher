/**
 * Listing tiles (S17). Search results, aisles and storefronts show a price on every product
 * tile, and most of what a shopper is shown is a tile, not a product page. This file is the
 * retailer-agnostic half: walk the tiles, read each one through the adapter's reader, keep
 * one observation per SKU, count what could not be read. The reader (which elements are
 * tiles, where the link, price and title sit) is the adapter's.
 *
 * Read only; never throws. A tile that throws is counted as `adapter_threw`, never rethrown.
 */
import type { ExtractFailureReason, ExtractResult, TileExtraction } from "./adapter";

export interface TileReader {
  /** Every candidate tile on the page, in document order. */
  tiles(doc: Document): Element[];
  /** One tile to one observation, or the reason it yielded none. */
  read(tile: Element): ExtractResult;
}

export function emptyTileExtraction(): TileExtraction {
  return { observations: [], skipped: {} };
}

function count(skipped: TileExtraction["skipped"], reason: ExtractFailureReason): void {
  skipped[reason] = (skipped[reason] ?? 0) + 1;
}

/**
 * Read every tile. The same product can appear twice on a listing (a sponsored slot and the
 * organic one); the first rendering wins, so a page yields at most one row per product URL.
 * The URL, not the SKU, because a cross-retailer search shows one product id under several
 * stores and the URL carries the store.
 */
export function collectTiles(doc: Document, reader: TileReader): TileExtraction {
  const out = emptyTileExtraction();
  let tiles: Element[];
  try {
    tiles = reader.tiles(doc);
  } catch {
    return out;
  }
  const seen = new Set<string>();
  for (const tile of tiles) {
    let result: ExtractResult;
    try {
      result = reader.read(tile);
    } catch {
      count(out.skipped, "adapter_threw");
      continue;
    }
    if (!result.ok) {
      count(out.skipped, result.reason);
      continue;
    }
    const url = result.observation.product.url;
    if (seen.has(url)) continue;
    seen.add(url);
    out.observations.push(result.observation);
  }
  return out;
}
