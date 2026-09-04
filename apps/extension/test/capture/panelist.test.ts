import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { PANELIST_KEY, PANELIST_ROTATION_MS, getPanelistId } from "../../src/capture/panelist";

const T0 = new Date("2026-09-04T15:00:00.000Z");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  fakeBrowser.reset();
});

describe("getPanelistId", () => {
  it("mints a UUID v4 and stores it with the mint time", async () => {
    const id = await getPanelistId(T0);
    expect(id).toMatch(UUID);
    const stored = await fakeBrowser.storage.local.get(PANELIST_KEY);
    expect(stored[PANELIST_KEY]).toEqual({ id, mintedAt: T0.toISOString() });
  });

  it("returns the same id while it is fresh", async () => {
    const id = await getPanelistId(T0);
    const later = new Date(T0.getTime() + PANELIST_ROTATION_MS - 1);
    expect(await getPanelistId(later)).toBe(id);
  });

  it("rotates once the rotation window has passed, and after a clock step backwards", async () => {
    const id = await getPanelistId(T0);
    const expired = new Date(T0.getTime() + PANELIST_ROTATION_MS);
    const rotated = await getPanelistId(expired);
    expect(rotated).not.toBe(id);
    expect(rotated).toMatch(UUID);
    const earlier = new Date(T0.getTime() - 1);
    expect(await getPanelistId(earlier)).not.toBe(rotated);
  });

  it("replaces garbage in storage", async () => {
    await fakeBrowser.storage.local.set({ [PANELIST_KEY]: "nope" });
    expect(await getPanelistId(T0)).toMatch(UUID);
  });

  it("uses the injected minter", async () => {
    const fixed = "6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    expect(await getPanelistId(T0, () => fixed)).toBe(fixed);
  });
});
