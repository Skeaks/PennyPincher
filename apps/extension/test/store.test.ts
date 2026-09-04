import { SCHEMA_VERSION } from "@pennypincher/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { acceptConsent } from "../src/lib/consent";
import {
  InvalidObservationError,
  MAX_ROWS,
  STORE_KEY,
  append,
  clear,
  count,
  exportAll,
  list,
} from "../src/store";
import { idFor, validObservation } from "./fixtures";

beforeEach(async () => {
  fakeBrowser.reset();
  await acceptConsent(new Date("2026-09-04T10:00:00.000Z"));
});

describe("append", () => {
  it("stores a valid observation and returns the new count", async () => {
    expect(await append(validObservation())).toBe(1);
    expect(await count()).toBe(1);
    expect(await list()).toEqual([validObservation()]);
  });

  it("keeps insertion order, oldest first", async () => {
    await append(validObservation({ observationId: idFor(1) }));
    await append(validObservation({ observationId: idFor(2) }));
    await append(validObservation({ observationId: idFor(3) }));
    expect((await list()).map((o) => o.observationId)).toEqual([idFor(1), idFor(2), idFor(3)]);
  });

  it("rejects an observation that fails the schema, storing nothing", async () => {
    const bad = validObservation();
    bad.facts = { ...bad.facts, price: { amountMinor: 1.5, currency: "USD" } };
    await expect(append(bad)).rejects.toBeInstanceOf(InvalidObservationError);
    expect(await count()).toBe(0);
  });

  it("rejects an observation carrying a forbidden (PII) key, storing nothing", async () => {
    const bad = { ...validObservation(), context: { ...validObservation().context, email: "a@b" } };
    await expect(append(bad)).rejects.toThrow(/forbidden key at context\.email/);
    expect(await count()).toBe(0);
  });

  it("rejects non-object garbage", async () => {
    await expect(append("nope")).rejects.toBeInstanceOf(InvalidObservationError);
    await expect(append(null)).rejects.toBeInstanceOf(InvalidObservationError);
  });

  it("concurrent appends do not lose rows", async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => append(validObservation({ observationId: idFor(i) }))),
    );
    expect(await count()).toBe(25);
  });
});

describe("FIFO cap", () => {
  it(`never exceeds MAX_ROWS (${MAX_ROWS}) and drops the oldest rows first`, async () => {
    // Seed storage directly with MAX_ROWS - 1 rows so the test stays fast; the last appends go
    // through the real code path.
    const seed = Array.from({ length: MAX_ROWS - 1 }, (_, i) =>
      validObservation({ observationId: idFor(i) }),
    );
    await fakeBrowser.storage.local.set({ [STORE_KEY]: seed });
    expect(await count()).toBe(MAX_ROWS - 1);

    expect(await append(validObservation({ observationId: idFor(MAX_ROWS - 1) }))).toBe(MAX_ROWS);
    expect(await append(validObservation({ observationId: idFor(MAX_ROWS) }))).toBe(MAX_ROWS);
    expect(await append(validObservation({ observationId: idFor(MAX_ROWS + 1) }))).toBe(MAX_ROWS);

    const rows = await list();
    expect(rows).toHaveLength(MAX_ROWS);
    expect(rows[0]?.observationId).toBe(idFor(2));
    expect(rows[rows.length - 1]?.observationId).toBe(idFor(MAX_ROWS + 1));
  });

  it("trims an over-full store left by an older build back to MAX_ROWS on the next append", async () => {
    const seed = Array.from({ length: MAX_ROWS + 10 }, (_, i) =>
      validObservation({ observationId: idFor(i) }),
    );
    await fakeBrowser.storage.local.set({ [STORE_KEY]: seed });
    expect(await append(validObservation({ observationId: idFor(MAX_ROWS + 10) }))).toBe(MAX_ROWS);
    const rows = await list();
    expect(rows[0]?.observationId).toBe(idFor(11));
  });
});

describe("clear and export", () => {
  it("clear removes every row but leaves consent alone", async () => {
    await append(validObservation());
    await clear();
    expect(await count()).toBe(0);
    const stored = await fakeBrowser.storage.local.get(null);
    expect(stored[STORE_KEY]).toBeUndefined();
    expect(stored["pp:consent"]).toBeDefined();
  });

  it("clear on an empty store is a no-op", async () => {
    await clear();
    expect(await count()).toBe(0);
  });

  it("export contains the rows, the consent record, and the schema version", async () => {
    await append(validObservation());
    const now = new Date("2026-09-05T00:00:00.000Z");
    const file = await exportAll(now);
    expect(file).toEqual({
      exportedAt: now.toISOString(),
      schemaVersion: SCHEMA_VERSION,
      consent: { version: 1, acceptedAt: "2026-09-04T10:00:00.000Z" },
      observations: [validObservation()],
    });
    // Round-trips through JSON unchanged: what the user downloads is what is stored.
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
  });

  it("list returns a copy; mutating it does not touch storage", async () => {
    await append(validObservation());
    const rows = await list();
    rows.pop();
    expect(await count()).toBe(1);
  });
});
