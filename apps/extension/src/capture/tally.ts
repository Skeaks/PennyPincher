/**
 * Listing tally (S17): how many prices the last visit to a listing page recorded, so the
 * popup can say so. A tile observation carries the tile's product URL, not the listing's, so
 * nothing in the observation store says which page a row was shown on; this small map does.
 *
 * Keyed by the canonical listing URL (query stripped, so no search term is stored). The value
 * is the count for the most recent page session on that path. Bounded; oldest entries drop.
 * Local only, like everything else in `chrome.storage.local`.
 */
import { browser } from "wxt/browser";

export const TALLY_KEY = "pp:listing-tally";
export const MAX_TALLY_ENTRIES = 50;

export interface ListingTallyEntry {
  /** Observations stored for this listing during its most recent page session. */
  recorded: number;
  /** ISO-8601 UTC of the last update. */
  at: string;
}

export type ListingTally = Record<string, ListingTallyEntry>;

function isEntry(value: unknown): value is ListingTallyEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ListingTallyEntry).recorded === "number" &&
    typeof (value as ListingTallyEntry).at === "string"
  );
}

export async function loadListingTally(): Promise<ListingTally> {
  const result = await browser.storage.local.get(TALLY_KEY);
  const raw = result[TALLY_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: ListingTally = {};
  for (const [url, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (isEntry(entry)) out[url] = entry;
  }
  return out;
}

/** Pure: the tally with `url` set to `recorded`, trimmed to the newest MAX_TALLY_ENTRIES. */
export function withTally(
  tally: ListingTally,
  url: string,
  recorded: number,
  now: Date,
): ListingTally {
  const next: ListingTally = { ...tally, [url]: { recorded, at: now.toISOString() } };
  const keys = Object.keys(next).sort((a, b) =>
    (next[a]?.at ?? "").localeCompare(next[b]?.at ?? ""),
  );
  while (keys.length > MAX_TALLY_ENTRIES) {
    const oldest = keys.shift();
    if (oldest !== undefined) delete next[oldest];
  }
  return next;
}

let writeQueue: Promise<unknown> = Promise.resolve();

/** Record the count for a listing. Writers are serialised so two pages cannot lose an entry. */
export function recordListingTally(url: string, recorded: number, now = new Date()): Promise<void> {
  const task = async (): Promise<void> => {
    const current = await loadListingTally();
    await browser.storage.local.set({ [TALLY_KEY]: withTally(current, url, recorded, now) });
  };
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

export async function clearListingTally(): Promise<void> {
  await browser.storage.local.remove(TALLY_KEY);
}
