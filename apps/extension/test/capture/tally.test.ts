/** The listing tally: the popup's "N prices on this page" count, kept in local storage. */
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { ListingCounter } from "../../src/capture/run";
import {
  MAX_TALLY_ENTRIES,
  TALLY_KEY,
  clearListingTally,
  loadListingTally,
  recordListingTally,
  withTally,
} from "../../src/capture/tally";

const T = new Date("2026-09-07T15:00:00.000Z");
const SEARCH = "https://www.instacart.com/store/walmart/s";

beforeEach(() => {
  fakeBrowser.reset();
});

describe("withTally", () => {
  it("sets the entry for the URL and stamps the time", () => {
    expect(withTally({}, SEARCH, 12, T)).toEqual({
      [SEARCH]: { recorded: 12, at: T.toISOString() },
    });
  });

  it("drops the oldest entries beyond the cap", () => {
    let tally = {};
    for (let i = 0; i < MAX_TALLY_ENTRIES + 5; i++) {
      tally = withTally(tally, `https://x.test/${i}`, i, new Date(T.getTime() + i * 1000));
    }
    const keys = Object.keys(tally);
    expect(keys).toHaveLength(MAX_TALLY_ENTRIES);
    expect(keys).not.toContain("https://x.test/0");
    expect(keys).toContain(`https://x.test/${MAX_TALLY_ENTRIES + 4}`);
  });
});

describe("recordListingTally / loadListingTally", () => {
  it("round-trips through storage and overwrites the same URL", async () => {
    await recordListingTally(SEARCH, 3, T);
    await recordListingTally(SEARCH, 7, new Date(T.getTime() + 1));
    expect(await loadListingTally()).toEqual({
      [SEARCH]: { recorded: 7, at: new Date(T.getTime() + 1).toISOString() },
    });
    await clearListingTally();
    expect(await loadListingTally()).toEqual({});
  });

  it("serialises concurrent writers so no entry is lost", async () => {
    await Promise.all([
      recordListingTally("https://a.test/", 1, T),
      recordListingTally("https://b.test/", 2, T),
      recordListingTally("https://c.test/", 3, T),
    ]);
    expect(Object.keys(await loadListingTally()).sort()).toEqual([
      "https://a.test/",
      "https://b.test/",
      "https://c.test/",
    ]);
  });

  it("tolerates garbage in storage", async () => {
    await fakeBrowser.storage.local.set({ [TALLY_KEY]: "nope" });
    expect(await loadListingTally()).toEqual({});
    await fakeBrowser.storage.local.set({ [TALLY_KEY]: { ok: { recorded: 1, at: "t" }, bad: 5 } });
    expect(await loadListingTally()).toEqual({ ok: { recorded: 1, at: "t" } });
  });
});

describe("ListingCounter", () => {
  it("accumulates within one search and starts over when the search changes", () => {
    const counter = new ListingCounter();
    expect(counter.add(SEARCH, `${SEARCH}?k=milk`, 10)).toBe(10);
    expect(counter.add(SEARCH, `${SEARCH}?k=milk`, 5)).toBe(15);
    expect(counter.add(SEARCH, `${SEARCH}?k=eggs`, 4)).toBe(4);
    expect(counter.add("https://other.test/", "https://other.test/?q=1", 1)).toBe(1);
    expect(counter.add(SEARCH, `${SEARCH}?k=eggs`, 0)).toBe(4);
  });
});
