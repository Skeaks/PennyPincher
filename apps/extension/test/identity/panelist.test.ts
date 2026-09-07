/**
 * Panelist rotation with history (S14): a new id every 7 days, the last four kept, all of
 * them listed for deletion, and the S04 storage shape of the current record unchanged.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { getPanelistId as legacyGetPanelistId } from "../../src/capture/panelist";
import {
  PANELIST_HISTORY_KEY,
  PANELIST_IDS_KEPT,
  PANELIST_KEY,
  PANELIST_ROTATION_MS,
  clearPanelistIds,
  getPanelistId,
  listPanelistIds,
} from "../../src/identity/panelist";

const T0 = new Date("2026-09-04T15:00:00.000Z");
const WEEK = 7 * 24 * 60 * 60 * 1000;

function week(n: number): Date {
  return new Date(T0.getTime() + n * WEEK);
}

let minted = 0;
const mint = () => `00000000-0000-4000-8000-${(++minted).toString(16).padStart(12, "0")}`;

beforeEach(() => {
  fakeBrowser.reset();
  minted = 0;
});

describe("rotation", () => {
  it("rotates every 7 days and keeps the retired ids newest first", async () => {
    expect(PANELIST_ROTATION_MS).toBe(WEEK);
    const first = await getPanelistId(week(0), mint);
    expect(await getPanelistId(new Date(week(1).getTime() - 1), mint)).toBe(first);
    const second = await getPanelistId(week(1), mint);
    expect(second).not.toBe(first);
    const third = await getPanelistId(week(2), mint);

    expect(await listPanelistIds()).toEqual([third, second, first]);
    const stored = await fakeBrowser.storage.local.get([PANELIST_KEY, PANELIST_HISTORY_KEY]);
    expect(stored[PANELIST_KEY]).toEqual({ id: third, mintedAt: week(2).toISOString() });
    expect(stored[PANELIST_HISTORY_KEY]).toEqual([
      { id: second, mintedAt: week(1).toISOString() },
      { id: first, mintedAt: week(0).toISOString() },
    ]);
  });

  it("keeps the last four ids in all, dropping the oldest", async () => {
    expect(PANELIST_IDS_KEPT).toBe(4);
    const ids: string[] = [];
    for (let n = 0; n < 6; n++) ids.push(await getPanelistId(week(n), mint));
    expect(new Set(ids).size).toBe(6);
    expect(await listPanelistIds()).toEqual([ids[5], ids[4], ids[3], ids[2]]);
  });

  it("a clock step backwards rotates too, and the old id is kept", async () => {
    const first = await getPanelistId(T0, mint);
    const rotated = await getPanelistId(new Date(T0.getTime() - 1), mint);
    expect(rotated).not.toBe(first);
    expect(await listPanelistIds()).toEqual([rotated, first]);
  });

  it("garbage in either key is ignored, not kept", async () => {
    await fakeBrowser.storage.local.set({
      [PANELIST_KEY]: "nope",
      [PANELIST_HISTORY_KEY]: [
        { id: 1 },
        "x",
        { id: "kept-id", mintedAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    const id = await getPanelistId(T0, mint);
    expect(await listPanelistIds()).toEqual([id, "kept-id"]);
  });

  it("lists nothing before the first mint and after clearing", async () => {
    expect(await listPanelistIds()).toEqual([]);
    await getPanelistId(week(0), mint);
    await getPanelistId(week(1), mint);
    await clearPanelistIds();
    expect(await listPanelistIds()).toEqual([]);
    expect(await fakeBrowser.storage.local.get([PANELIST_KEY, PANELIST_HISTORY_KEY])).toEqual({});
    // The next capture mints afresh.
    expect(await getPanelistId(week(2), mint)).toMatch(/^00000000-/);
  });

  it("the capture/panelist path is the same function", async () => {
    const id = await legacyGetPanelistId(T0, mint);
    expect(await getPanelistId(T0, mint)).toBe(id);
  });
});
