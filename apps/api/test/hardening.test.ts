/**
 * Ingest hardening (S14): the hourly rate limit, semantic dedup of repeat views, the abuse
 * guard and its exclusion from the cell query, DELETE /v1/panelists/:id, and retention. All
 * on the in-memory repo; no network.
 */
import type { PriceObservation } from "@pennypincher/schema";
import { describe, expect, it } from "vitest";
import migration from "../migrations/0002_ingest_hardening.sql?raw";
import { createApp } from "../src/app";
import {
  MIN_REFERENCE_PANELISTS,
  activeSuspects,
  evaluateSuspect,
  panelistCells,
} from "../src/ingest/abuse";
import { SEMANTIC_DEDUP_MS, dedupeSemantic, semanticKey, twinSpan } from "../src/ingest/dedup";
import {
  RATE_LIMIT_PER_HOUR,
  demandsFor,
  overLimit,
  panelistKey,
  scopeOf,
  secondsUntilNextWindow,
  tokenKey,
  windowStart,
} from "../src/ingest/ratelimit";
import { INSERT_FLAG_SQL, RATE_ADD_SQL } from "../src/repo/d1";
import { MemoryObservationRepo } from "../src/repo/memory";
import { type PanelistFlag, toRow } from "../src/repo/observations";
import {
  BUCKET_RETENTION_MS,
  RAW_RETENTION_DAYS,
  retentionCutoff,
  runRetention,
} from "../src/retention";
import type { CellResponse } from "../src/routes/cells";
import { parsePanelistId } from "../src/routes/panelists";
import { FIXED_NOW, uuidFor, validObservation } from "./fixtures";

const BANANAS = "instacart|10769|2748189|delivery|085";
const BANANAS_URL = `/v1/cells/${encodeURIComponent(BANANAS)}`;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const PANELIST_A = "0b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8";
const PANELIST_B = "1b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8";
const PANELIST_C = "2b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8";
const PANELIST_D = "3b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8";
const PANELIST_X = "9b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8";

let counter = 1000;

/** An observation `minutes` after the fixture's observedAt, with a fresh id. */
function at(
  minutes: number,
  overrides: Partial<PriceObservation> = {},
  base = validObservation(),
): PriceObservation {
  counter += 1;
  return validObservation({
    observationId: uuidFor(counter),
    observedAt: new Date(Date.parse(base.observedAt) + minutes * MINUTE).toISOString(),
    ...overrides,
  });
}

function priced(minutes: number, panelistId: string, amountMinor: number): PriceObservation {
  const base = validObservation();
  return at(minutes, {
    panelistId,
    facts: { ...base.facts, price: { amountMinor, currency: "USD" } },
  });
}

/** `n` distinct products (one cell each) for `panelistId`, so nothing dedups. */
function distinct(n: number, panelistId = PANELIST_A): PriceObservation[] {
  const base = validObservation();
  return Array.from({ length: n }, () =>
    at(0, { panelistId, product: { ...base.product, retailerSku: `sku-${++counter}` } }),
  );
}

function hardenedApp(clock: { now: Date } = { now: FIXED_NOW }, token?: string) {
  const repo = new MemoryObservationRepo();
  const logs: string[] = [];
  const app = createApp<{ PILOT_TOKEN?: string }>({
    repo: () => repo,
    now: () => clock.now,
    pilotToken: (env) => env.PILOT_TOKEN,
    log: (line) => logs.push(line),
  });
  const env = token ? { PILOT_TOKEN: token } : {};
  const auth: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const post = (observations: PriceObservation[]) =>
    app.request(
      "/v1/observations",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ observations }),
      },
      env,
    );
  const del = (id: string, headers: Record<string, string> = auth) =>
    app.request(`/v1/panelists/${id}`, { method: "DELETE", headers }, env);
  const cell = async (url = BANANAS_URL) => {
    const res = await app.request(url, { headers: auth }, env);
    return { res, body: (await res.json()) as CellResponse };
  };
  const events = () =>
    logs.map((l) => JSON.parse(l) as { event: string } & Record<string, unknown>);
  return { app, repo, post, del, cell, logs, events, clock };
}

describe("rate limit", () => {
  it("windows are the top of the hour and Retry-After counts to the next one", () => {
    expect(windowStart(new Date("2026-09-04T16:42:10.000Z"))).toBe("2026-09-04T16:00:00.000Z");
    expect(secondsUntilNextWindow(new Date("2026-09-04T16:42:10.000Z"))).toBe(1070);
    expect(secondsUntilNextWindow(new Date("2026-09-04T16:59:59.900Z"))).toBe(1);
  });

  it("keys the token bucket on a hash of the bearer, never the bearer", async () => {
    const key = await tokenKey("test-pilot-bearer");
    expect(key).toMatch(/^token:[0-9a-f]{16}$/);
    expect(key).not.toContain("test-pilot-bearer");
    expect(await tokenKey("test-pilot-bearer")).toBe(key);
    expect(await tokenKey("other")).not.toBe(key);
    expect(await tokenKey(undefined)).toBe("token:open");
  });

  it("demands one token bucket and one bucket per panelist", () => {
    const rows = [...distinct(3, PANELIST_A), ...distinct(2, PANELIST_B)].map((o) =>
      toRow(o, FIXED_NOW.toISOString()),
    );
    expect(demandsFor(rows, "token:abc")).toEqual([
      { key: "token:abc", count: 5 },
      { key: panelistKey(PANELIST_A), count: 3 },
      { key: panelistKey(PANELIST_B), count: 2 },
    ]);
  });

  it("refuses the first demand that would pass the limit, per scope", () => {
    const token = { key: "token:abc", count: 10 };
    const panelist = { key: panelistKey(PANELIST_A), count: 10 };
    const demands = [token, panelist];
    expect(overLimit(new Map(), demands, 10)).toBeUndefined();
    expect(overLimit(new Map([["token:abc", 1]]), demands, 10)?.key).toBe("token:abc");
    const panelistOver = new Map([[panelistKey(PANELIST_A), 991]]);
    const refused = overLimit(panelistOver, demands);
    expect(refused?.key).toBe(panelistKey(PANELIST_A));
    expect(scopeOf(refused ?? token)).toBe("panelist");
    expect(scopeOf(token)).toBe("token");
    expect(RATE_LIMIT_PER_HOUR).toBe(1000);
  });

  it("accepts 1,000 observations in an hour, 429s the 1,001st, and stores nothing from the refused batch", async () => {
    const { repo, post } = hardenedApp(
      { now: new Date("2026-09-04T16:00:00.000Z") },
      "test-pilot-bearer",
    );
    for (let i = 0; i < 5; i++) {
      const res = await post(distinct(200));
      expect(res.status).toBe(201);
    }
    expect(repo.rows.size).toBe(1000);

    const res = await post(distinct(1));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(await res.json()).toEqual({
      errors: ["rate limit exceeded for token: 1000 observations per hour"],
    });
    expect(repo.rows.size).toBe(1000);
  });

  it("does not count a refused batch, and opens again in the next window", async () => {
    const clock = { now: new Date("2026-09-04T16:30:00.000Z") };
    const { repo, post } = hardenedApp(clock, "test-pilot-bearer");
    for (let i = 0; i < 5; i++) await post(distinct(200));
    expect((await post(distinct(200))).status).toBe(429);
    // Still exactly at the limit: the 429 did not add to the bucket.
    const window = windowStart(clock.now);
    expect(await repo.rateCounts([panelistKey(PANELIST_A)], window)).toEqual(
      new Map([[panelistKey(PANELIST_A), 1000]]),
    );

    clock.now = new Date("2026-09-04T17:00:00.000Z");
    const res = await post(distinct(1));
    expect(res.status).toBe(201);
    expect(repo.rows.size).toBe(1001);
  });

  it("counts a panelist across batches even when the batch mixes panelists", async () => {
    const { post } = hardenedApp({ now: new Date("2026-09-04T16:00:00.000Z") });
    for (let i = 0; i < 4; i++) expect((await post(distinct(200))).status).toBe(201);
    // 800 for A. A batch of 150 A + 50 B fits (token 1000, A 950); the next A row does not.
    expect((await post([...distinct(150), ...distinct(50, PANELIST_B)])).status).toBe(201);
    const res = await post(distinct(1));
    expect(res.status).toBe(429);
  });
});

describe("semantic dedup", () => {
  it("keys on panelist, cell, price and currency", () => {
    const row = toRow(validObservation(), FIXED_NOW.toISOString());
    expect(semanticKey(row)).toBe(`${PANELIST_A}|${BANANAS}|22|USD`);
  });

  it("keeps one view per ten minutes: of views at 0, 9 and 18 minutes the first and last stay", () => {
    const rows = [at(9), at(0), at(18)].map((o) => toRow(o, FIXED_NOW.toISOString()));
    const result = dedupeSemantic(rows, []);
    expect(result.duplicates).toBe(1);
    expect(result.kept.map((r) => r.observedAt)).toEqual([
      rows[1]?.observedAt,
      rows[2]?.observedAt,
    ]);
    expect(SEMANTIC_DEDUP_MS).toBe(10 * MINUTE);
  });

  it("treats a stored twin like a kept one, in either direction", () => {
    const stored = [toRow(at(10), FIXED_NOW.toISOString())];
    const before = toRow(at(1), FIXED_NOW.toISOString());
    const after = toRow(at(19), FIXED_NOW.toISOString());
    const clear = toRow(at(20), FIXED_NOW.toISOString());
    expect(dedupeSemantic([before, after, clear], stored)).toEqual({
      kept: [clear],
      duplicates: 2,
    });
  });

  it("a different price, cell, or panelist is never a duplicate", () => {
    const base = validObservation();
    const rows = [
      at(0),
      at(1, { facts: { ...base.facts, price: { amountMinor: 23, currency: "USD" } } }),
      at(1, { product: { ...base.product, retailerSku: "other" } }),
      at(1, { panelistId: PANELIST_B }),
    ].map((o) => toRow(o, FIXED_NOW.toISOString()));
    expect(dedupeSemantic(rows, [])).toEqual({ kept: rows, duplicates: 0 });
  });

  it("twinSpan covers the batch plus the window on both sides", () => {
    const rows = [at(5), at(0), at(30)].map((o) => toRow(o, FIXED_NOW.toISOString()));
    const span = twinSpan(rows);
    expect(span.from.toISOString()).toBe(at(-10).observedAt);
    expect(span.to.toISOString()).toBe(at(40).observedAt);
  });

  it("over HTTP: repeat views are counted as duplicates, not stored, and stable on resend", async () => {
    const { repo, post } = hardenedApp();
    const first = at(0);
    const repeat = at(9);
    const later = at(18);

    const res = await post([first, repeat, later]);
    expect(await res.json()).toEqual({ accepted: 2, duplicates: 1 });
    expect(repo.rows.size).toBe(2);
    expect(await repo.getById(repeat.observationId)).toBeUndefined();

    // Resending the dropped one alone is still a duplicate of the stored first view.
    expect(await (await post([repeat])).json()).toEqual({ accepted: 0, duplicates: 1 });
    // Resending a stored one is an id duplicate; both kinds share the counter.
    expect(await (await post([first, repeat])).json()).toEqual({ accepted: 0, duplicates: 2 });
    expect(repo.rows.size).toBe(2);
  });

  it("repeat views do not inflate the cell's observation count", async () => {
    const { post, cell } = hardenedApp();
    await post([at(0), at(1), at(2), at(3), at(4)]);
    const { body } = await cell();
    expect(body.observations).toBe(1);
    expect(body.panelists).toBe(1);
  });
});

describe("abuse guard", () => {
  /** Three honest panelists on a 199/249/299 ladder, observed in the last hour. */
  function reference(): PriceObservation[] {
    return [priced(0, PANELIST_B, 199), priced(1, PANELIST_C, 249), priced(2, PANELIST_D, 299)];
  }

  it("evaluateSuspect flags a panelist whose every price is outside the others' range by more than 50%", () => {
    const rows = [...reference(), priced(3, PANELIST_X, 999)].map((o) =>
      toRow(o, FIXED_NOW.toISOString()),
    );
    const verdict = evaluateSuspect(PANELIST_X, rows);
    expect(verdict.suspect).toBe(true);
    expect(verdict.reason).toContain("[199, 299]");
    expect(verdict.reason).toContain("3 other panelists");
    // Too low counts too.
    const low = [...reference(), priced(3, PANELIST_X, 50)].map((o) =>
      toRow(o, FIXED_NOW.toISOString()),
    );
    expect(evaluateSuspect(PANELIST_X, low).suspect).toBe(true);
  });

  it("does not flag inside the 50% band, a mixed panelist, or with too few reference panelists", () => {
    const stamp = FIXED_NOW.toISOString();
    const inBand = [...reference(), priced(3, PANELIST_X, 448)].map((o) => toRow(o, stamp));
    expect(evaluateSuspect(PANELIST_X, inBand).suspect).toBe(false);
    const edgeLow = [...reference(), priced(3, PANELIST_X, 100)].map((o) => toRow(o, stamp));
    expect(evaluateSuspect(PANELIST_X, edgeLow).suspect).toBe(false);

    const mixed = [...reference(), priced(3, PANELIST_X, 999), priced(4, PANELIST_X, 249)].map(
      (o) => toRow(o, stamp),
    );
    expect(evaluateSuspect(PANELIST_X, mixed).suspect).toBe(false);

    const few = [
      priced(0, PANELIST_B, 199),
      priced(1, PANELIST_C, 249),
      priced(3, PANELIST_X, 999),
    ].map((o) => toRow(o, stamp));
    expect(evaluateSuspect(PANELIST_X, few).suspect).toBe(false);
    expect(MIN_REFERENCE_PANELISTS).toBe(3);

    // A panelist with no rows in the cell is nothing.
    expect(
      evaluateSuspect(
        PANELIST_A,
        reference().map((o) => toRow(o, stamp)),
      ).suspect,
    ).toBe(false);
  });

  it("suspects do not form the reference range for others", () => {
    const stamp = FIXED_NOW.toISOString();
    const rows = [...reference(), priced(3, PANELIST_X, 999), priced(4, PANELIST_A, 950)].map((o) =>
      toRow(o, stamp),
    );
    // With X counted as reference the range is [199, 999] and A's 950 is inside it.
    expect(evaluateSuspect(PANELIST_A, rows).suspect).toBe(false);
    expect(evaluateSuspect(PANELIST_A, rows, new Set([PANELIST_X])).suspect).toBe(true);
  });

  it("activeSuspects is every flag still suspect, reviewed or not; panelistCells is distinct pairs in order", () => {
    const flag = (panelistId: string, extra: Partial<PanelistFlag>): PanelistFlag => ({
      panelistId,
      status: "suspect",
      reason: "r",
      cellKey: BANANAS,
      flaggedAt: FIXED_NOW.toISOString(),
      reviewedAt: null,
      reviewNote: null,
      ...extra,
    });
    expect(
      activeSuspects([
        flag(PANELIST_A, {}),
        flag(PANELIST_B, { reviewedAt: FIXED_NOW.toISOString() }),
        flag(PANELIST_C, { status: "cleared", reviewedAt: FIXED_NOW.toISOString() }),
      ]),
    ).toEqual(new Set([PANELIST_A, PANELIST_B]));

    const rows = [at(0), at(1), at(0, { panelistId: PANELIST_B }), at(2)].map((o) =>
      toRow(o, FIXED_NOW.toISOString()),
    );
    expect(panelistCells(rows)).toEqual([
      { panelistId: PANELIST_A, cellKey: BANANAS },
      { panelistId: PANELIST_B, cellKey: BANANAS },
    ]);
  });

  it("over HTTP: flags on ingest, logs it, keeps the rows, and excludes the panelist from the cell", async () => {
    const { repo, post, cell, events } = hardenedApp();
    await post(reference());
    expect(repo.flags.size).toBe(0);

    const res = await post([priced(3, PANELIST_X, 999)]);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0 });
    expect(repo.rows.size).toBe(4);

    const flag = repo.flags.get(PANELIST_X);
    expect(flag).toMatchObject({
      panelistId: PANELIST_X,
      status: "suspect",
      cellKey: BANANAS,
      flaggedAt: FIXED_NOW.toISOString(),
      reviewedAt: null,
    });
    expect(events().filter((e) => e.event === "panelist_flagged")).toHaveLength(1);

    const { body } = await cell();
    expect(body.panelists).toBe(3);
    expect(body.observations).toBe(3);
    expect(events().some((e) => e.event === "suspects_excluded" && e.panelists === 1)).toBe(true);

    // A later honest-looking row does not lift the flag: the first flag sticks until review.
    await post([priced(20, PANELIST_X, 249)]);
    expect(repo.flags.get(PANELIST_X)?.flaggedAt).toBe(FIXED_NOW.toISOString());
    expect((await cell()).body.panelists).toBe(3);
  });

  it("a reviewed flag stops excluding", async () => {
    const { repo, post, cell } = hardenedApp();
    await post([...reference(), priced(3, PANELIST_X, 999)]);
    expect(repo.flags.has(PANELIST_X)).toBe(true);
    expect((await cell()).body.panelists).toBe(3);

    const flag = repo.flags.get(PANELIST_X);
    if (flag)
      repo.flags.set(PANELIST_X, {
        ...flag,
        status: "cleared",
        reviewedAt: FIXED_NOW.toISOString(),
      });
    expect((await cell()).body.panelists).toBe(4);
  });

  it("never flags on a cell with fewer than three other panelists", async () => {
    const { repo, post } = hardenedApp();
    await post([
      priced(0, PANELIST_B, 199),
      priced(1, PANELIST_C, 249),
      priced(3, PANELIST_X, 999),
    ]);
    expect(repo.flags.size).toBe(0);
  });
});

describe("DELETE /v1/panelists/:id", () => {
  it("removes every row, flag and bucket for the id and nothing else; repeat is 200 with 0", async () => {
    const { repo, post, del, events } = hardenedApp();
    await post([...distinct(3, PANELIST_A), ...distinct(2, PANELIST_B)]);
    await post([
      priced(0, PANELIST_B, 199),
      priced(1, PANELIST_C, 249),
      priced(2, PANELIST_D, 299),
      priced(3, PANELIST_A, 999),
    ]);
    expect(repo.flags.has(PANELIST_A)).toBe(true);
    expect(repo.rows.size).toBe(9);

    const res = await del(PANELIST_A);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ panelistId: PANELIST_A, deleted: 4 });
    expect([...repo.rows.values()].some((r) => r.panelistId === PANELIST_A)).toBe(false);
    expect(repo.rows.size).toBe(5);
    expect(repo.flags.has(PANELIST_A)).toBe(false);
    expect([...repo.buckets.keys()].some((k) => k.endsWith(panelistKey(PANELIST_A)))).toBe(false);
    expect([...repo.buckets.keys()].some((k) => k.endsWith(panelistKey(PANELIST_B)))).toBe(true);
    expect(events().filter((e) => e.event === "panelist_deleted")).toEqual([
      { event: "panelist_deleted", panelistId: PANELIST_A, observations: 4 },
    ]);

    expect(await (await del(PANELIST_A)).json()).toEqual({ panelistId: PANELIST_A, deleted: 0 });
  });

  it("400 on a non-UUID id, 401 without the bearer", async () => {
    const { del } = hardenedApp({ now: FIXED_NOW }, "test-pilot-bearer");
    expect((await del("not-a-uuid")).status).toBe(400);
    expect((await del("../observations")).status).toBe(404);
    const denied = await del(PANELIST_A, {});
    expect(denied.status).toBe(401);
    expect(parsePanelistId(PANELIST_A)).toBe(PANELIST_A);
    expect(parsePanelistId(PANELIST_A.toUpperCase())).toBe(PANELIST_A.toUpperCase());
    expect(parsePanelistId("")).toBeUndefined();
  });
});

describe("retention", () => {
  it("purges raw rows and flags older than 90 days by receipt, and stale buckets", async () => {
    const repo = new MemoryObservationRepo();
    const now = new Date("2026-12-10T12:00:00.000Z");
    const old = new Date(now.getTime() - (RAW_RETENTION_DAYS + 1) * 24 * HOUR).toISOString();
    const fresh = new Date(now.getTime() - (RAW_RETENTION_DAYS - 1) * 24 * HOUR).toISOString();
    await repo.insertMany([toRow(at(0), old), toRow(at(1, { panelistId: PANELIST_B }), fresh)]);
    await repo.flagPanelist({
      panelistId: PANELIST_A,
      status: "suspect",
      reason: "r",
      cellKey: BANANAS,
      flaggedAt: old,
      reviewedAt: null,
      reviewNote: null,
    });
    await repo.flagPanelist({
      panelistId: PANELIST_B,
      status: "suspect",
      reason: "r",
      cellKey: BANANAS,
      flaggedAt: fresh,
      reviewedAt: null,
      reviewNote: null,
    });
    await repo.rateAdd(
      [{ key: "token:x", count: 1 }],
      windowStart(new Date(now.getTime() - 3 * HOUR)),
    );
    await repo.rateAdd([{ key: "token:x", count: 1 }], windowStart(now));

    const logs: string[] = [];
    const result = await runRetention(repo, now, (l) => logs.push(l));
    expect(result).toEqual({ observations: 1, flags: 1, buckets: 1 });
    expect(repo.rows.size).toBe(1);
    expect(repo.flags.has(PANELIST_B)).toBe(true);
    expect(repo.buckets.size).toBe(1);
    expect(JSON.parse(logs[0] ?? "{}")).toMatchObject({
      event: "retention_purge",
      cutoff: retentionCutoff(now).toISOString(),
      observations: 1,
    });
    expect(BUCKET_RETENTION_MS).toBe(2 * HOUR);
  });
});

describe("migration 0002 and D1 statements", () => {
  it("adds the panelist index and the two tables the repo writes to", () => {
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS \w+\s+ON observations \(panelist_id, observed_at\)/,
    );
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS rate_buckets/);
    expect(migration).toMatch(/PRIMARY KEY \(bucket_key, window_start\)/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS panelist_flags/);
    expect(migration).toMatch(/panelist_id TEXT PRIMARY KEY/);
    expect(migration).not.toMatch(/ALTER TABLE observations/);
  });

  it("the flag insert names exactly the panelist_flags columns; the bucket add upserts", () => {
    const body =
      /CREATE TABLE IF NOT EXISTS panelist_flags \(([^;]*)\);/.exec(migration)?.[1] ?? "";
    const columns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("--"))
      .map((line) => line.split(/\s+/)[0] ?? "");
    const inserted = /INSERT OR IGNORE INTO panelist_flags \(([^)]*)\)/
      .exec(INSERT_FLAG_SQL)?.[1]
      ?.split(",")
      .map((c) => c.trim());
    expect(inserted).toEqual(columns);
    expect(RATE_ADD_SQL).toMatch(
      /ON CONFLICT \(bucket_key, window_start\) DO UPDATE SET count = count \+ excluded\.count/,
    );
  });
});
