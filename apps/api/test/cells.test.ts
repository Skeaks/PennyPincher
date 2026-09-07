import type { PriceObservation } from "@pennypincher/schema";
import { DEFAULT_WINDOW_HOURS, explain, requiredObservations } from "@pennypincher/stats";
import { generateLadder } from "@pennypincher/synth";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { MemoryObservationRepo } from "../src/repo/memory";
import { type ObservationRow, cellKey, toRow } from "../src/repo/observations";
import {
  CELL_CACHE_SECONDS,
  type CellCache,
  type CellResponse,
  onePerPanelist,
  parseCellKey,
  queryCell,
} from "../src/routes/cells";
import { FIXED_NOW, testApp, uuidFor, validObservation } from "./fixtures";

/** The cell every fixture observation lands in (see repo.test.ts). */
const BANANAS = "instacart|10769|2748189|delivery|085";
const BANANAS_URL = `/v1/cells/${encodeURIComponent(BANANAS)}`;

/** Synth samples start at 2026-09-04T15:26:18Z, one observation a minute. */
const SYNTH_START = Date.parse("2026-09-04T15:26:18.000Z");
const HOUR = 3_600_000;

async function seed(repo: MemoryObservationRepo, observations: PriceObservation[]) {
  const receivedAt = FIXED_NOW.toISOString();
  return repo.insertMany(observations.map((o) => toRow(o, receivedAt)));
}

async function getCell(app: ReturnType<typeof testApp>["app"], url = BANANAS_URL) {
  const res = await app.request(url);
  return { res, body: (await res.json()) as CellResponse };
}

describe("GET /v1/cells/:cellKey", () => {
  it("NO DATA: an unknown cell is UNRESOLVED / no_observations with zero counts", async () => {
    const { app } = testApp();
    const { res, body } = await getCell(app);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(`public, max-age=${CELL_CACHE_SECONDS}`);
    expect(body).toEqual({
      cellKey: BANANAS,
      resolution: {
        status: "UNRESOLVED",
        reason: "no_observations",
        n: 0,
        needed: requiredObservations(2),
        tiersSeen: 0,
        currency: "USD",
        windowHours: DEFAULT_WINDOW_HOURS,
      },
      n: 0,
      panelists: 0,
      observations: 0,
      latestObservedAt: null,
      updatedAt: FIXED_NOW.toISOString(),
      summary: explain(body.resolution),
      windowHours: DEFAULT_WINDOW_HOURS,
    });
  });

  it("RESOLVED: distinct panelists on an i.i.d. three-tier ladder", async () => {
    const { repo } = testApp();
    const ladder = generateLadder({ tiers: [199, 249, 299], seed: 11 });
    const sample = ladder.sample(60);
    await seed(repo, sample);
    const now = new Date(SYNTH_START + 60 * 60_000);
    const cellApp = createApp<Record<string, never>>({ repo: () => repo, now: () => now });

    const { res, body } = await getCell(cellApp);

    expect(res.status).toBe(200);
    expect(body.resolution.status).toBe("RESOLVED");
    if (body.resolution.status !== "RESOLVED") return;
    expect(body.resolution.tiers.map((t) => t.price)).toEqual([199, 249, 299]);
    expect(body.resolution.floor).toBe(199);
    expect(body.resolution.n).toBe(60);
    expect(body.n).toBe(60);
    expect(body.panelists).toBe(60);
    expect(body.observations).toBe(60);
    expect(body.latestObservedAt).toBe(sample[59]?.observedAt);
    expect(body.updatedAt).toBe(now.toISOString());
    expect(body.summary).toBe(explain(body.resolution));
    expect(cellKey(sample[0] as PriceObservation)).toBe(BANANAS);
  });

  it("one vote per panelist: stickiness 1 over 10 observers and 200 draws reports n = 10, UNRESOLVED / insufficient_n", async () => {
    const { repo } = testApp();
    // Five uniform tiers so ten independent votes cannot clear the coupon threshold (18 for
    // k = 5, 13 for k = 4) however the ten observers happen to be assigned.
    const ladder = generateLadder({
      tiers: [199, 229, 249, 279, 299],
      stickiness: 1,
      observers: 10,
      seed: "s11-sticky",
    });
    const sample = ladder.sample(200);
    expect(new Set(sample.map((o) => o.panelistId)).size).toBe(10);
    expect(await seed(repo, sample)).toEqual({ accepted: 200, duplicates: 0 });
    const now = new Date(SYNTH_START + 200 * 60_000);
    const app = createApp<Record<string, never>>({ repo: () => repo, now: () => now });

    const { res, body } = await getCell(app);

    expect(res.status).toBe(200);
    expect(body.observations).toBe(200);
    expect(body.panelists).toBe(10);
    expect(body.n).toBe(10);
    expect(body.resolution.n).toBe(10);
    expect(body.resolution).toMatchObject({ status: "UNRESOLVED", reason: "insufficient_n" });
    expect(body.summary).toContain("10 observations");
    expect(body.summary).not.toContain("200");
  });

  it("only counts rows inside the last 72 h and never rows dated after now", async () => {
    const { repo } = testApp();
    const now = FIXED_NOW;
    const at = (offsetHours: number) => new Date(now.getTime() + offsetHours * HOUR).toISOString();
    await seed(repo, [
      validObservation({
        observationId: uuidFor(1),
        panelistId: uuidFor(101),
        observedAt: at(-73),
      }),
      validObservation({
        observationId: uuidFor(2),
        panelistId: uuidFor(102),
        observedAt: at(-71),
      }),
      validObservation({ observationId: uuidFor(3), panelistId: uuidFor(103), observedAt: at(-1) }),
      validObservation({ observationId: uuidFor(4), panelistId: uuidFor(104), observedAt: at(0) }),
      validObservation({ observationId: uuidFor(5), panelistId: uuidFor(105), observedAt: at(1) }),
    ]);
    const app = createApp<Record<string, never>>({ repo: () => repo, now: () => now });

    const { body } = await getCell(app);

    expect(body.observations).toBe(3);
    expect(body.panelists).toBe(3);
    expect(body.latestObservedAt).toBe(at(0));
  });

  it("only reads the requested cell", async () => {
    const { repo } = testApp();
    const o = validObservation();
    await seed(repo, [
      validObservation({ observationId: uuidFor(1), panelistId: uuidFor(101) }),
      validObservation({
        observationId: uuidFor(2),
        panelistId: uuidFor(102),
        context: { ...o.context, zip3: "100" },
      }),
    ]);
    const app = createApp<Record<string, never>>({ repo: () => repo, now: () => FIXED_NOW });

    expect((await getCell(app)).body.observations).toBe(1);
    const other = await getCell(
      app,
      `/v1/cells/${encodeURIComponent("instacart|10769|2748189|delivery|100")}`,
    );
    expect(other.body.observations).toBe(1);
    expect(other.body.cellKey).toBe("instacart|10769|2748189|delivery|100");
  });

  it("accepts the key with literal pipes as well as percent-encoded ones", async () => {
    const { repo } = testApp();
    await seed(repo, [validObservation()]);
    const app = createApp<Record<string, never>>({ repo: () => repo, now: () => FIXED_NOW });

    const literal = await getCell(app, `/v1/cells/${BANANAS}`);
    expect(literal.res.status).toBe(200);
    expect(literal.body.cellKey).toBe(BANANAS);
    expect(literal.body.observations).toBe(1);
  });

  it("rejects a key that is not five pipe-separated parts with 400", async () => {
    const { app } = testApp();
    for (const bad of [
      "bananas",
      "instacart|10769|2748189|delivery",
      "a|b|c|d|e|f",
      "|10769|2748189|delivery|085",
    ]) {
      const res = await app.request(`/v1/cells/${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        errors: ["cellKey must be retailer|retailerStoreId|retailerSku|fulfillment|zip3"],
      });
    }
  });
});

describe("GET /v1/cells/:cellKey bearer token", () => {
  // Deliberately low-entropy so gitleaks does not flag a test fixture as a leaked secret.
  const TOKEN = "test-pilot-bearer";
  function protectedApp() {
    const repo = new MemoryObservationRepo();
    const app = createApp<{ PILOT_TOKEN?: string }>({
      repo: () => repo,
      now: () => FIXED_NOW,
      pilotToken: (env) => env.PILOT_TOKEN,
    });
    return (headers: Record<string, string>, env: { PILOT_TOKEN?: string }) =>
      app.request(BANANAS_URL, { headers }, env);
  }

  it("accepts the configured bearer", async () => {
    const get = protectedApp();
    expect((await get({ authorization: `Bearer ${TOKEN}` }, { PILOT_TOKEN: TOKEN })).status).toBe(
      200,
    );
  });

  it("rejects a missing or wrong bearer with 401", async () => {
    const get = protectedApp();
    for (const headers of [{}, { authorization: `Bearer ${TOKEN}x` }, { authorization: TOKEN }]) {
      const res = await get(headers, { PILOT_TOKEN: TOKEN });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ errors: ["unauthorized"] });
    }
  });

  it("is open when no token is configured (local dev)", async () => {
    const get = protectedApp();
    expect((await get({}, {})).status).toBe(200);
  });
});

describe("GET /v1/cells/:cellKey edge cache", () => {
  /** A Map-backed stand-in for `caches.default`, keyed on the request URL. */
  function fakeCache() {
    const store = new Map<string, Response>();
    const keys: string[] = [];
    const cache: CellCache = {
      async match(key) {
        return store.get(key.url)?.clone();
      },
      async put(key, response) {
        keys.push(key.url);
        store.set(key.url, response);
      },
    };
    return { cache, store, keys };
  }

  function countingRepo() {
    const repo = new MemoryObservationRepo();
    let reads = 0;
    const original = repo.listByCell.bind(repo);
    repo.listByCell = async (...args) => {
      reads += 1;
      return original(...args);
    };
    return { repo, reads: () => reads };
  }

  it("serves the second request from the cache without reading the repo", async () => {
    const { repo, reads } = countingRepo();
    const { cache, keys } = fakeCache();
    let tick = 0;
    const app = createApp<Record<string, never>>({
      repo: () => repo,
      now: () => new Date(FIXED_NOW.getTime() + tick++ * 1000),
      cache: () => cache,
    });

    const first = await getCell(app);
    const second = await getCell(app);

    expect(reads()).toBe(1);
    expect(second.body).toEqual(first.body);
    expect(second.body.updatedAt).toBe(FIXED_NOW.toISOString());
    expect(second.res.headers.get("cache-control")).toBe(`public, max-age=${CELL_CACHE_SECONDS}`);
    expect(keys).toEqual([`http://localhost${BANANAS_URL}`]);
  });

  it("checks the bearer before the cache, so a cached answer is never served unauthenticated", async () => {
    const TOKEN = "test-pilot-bearer";
    const { repo } = countingRepo();
    const { cache } = fakeCache();
    const app = createApp<{ PILOT_TOKEN?: string }>({
      repo: () => repo,
      now: () => FIXED_NOW,
      pilotToken: (env) => env.PILOT_TOKEN,
      cache: () => cache,
    });
    const env = { PILOT_TOKEN: TOKEN };

    const warm = await app.request(
      BANANAS_URL,
      { headers: { authorization: `Bearer ${TOKEN}` } },
      env,
    );
    expect(warm.status).toBe(200);
    const cold = await app.request(BANANAS_URL, {}, env);
    expect(cold.status).toBe(401);
  });

  it("does not cache a 400", async () => {
    const { repo } = countingRepo();
    const { cache, store } = fakeCache();
    const app = createApp<Record<string, never>>({ repo: () => repo, cache: () => cache });
    expect((await app.request("/v1/cells/nope")).status).toBe(400);
    expect(store.size).toBe(0);
  });
});

describe("onePerPanelist", () => {
  const row = (
    id: number,
    panelist: number,
    observedAt: string,
    receivedAt = FIXED_NOW.toISOString(),
  ) =>
    toRow(
      validObservation({ observationId: uuidFor(id), panelistId: uuidFor(panelist), observedAt }),
      receivedAt,
    );

  it("keeps the latest observation of each panelist, ascending by observedAt", () => {
    const rows: ObservationRow[] = [
      row(1, 1, "2026-09-04T10:00:00.000Z"),
      row(2, 1, "2026-09-04T12:00:00.000Z"),
      row(3, 2, "2026-09-04T11:00:00.000Z"),
      row(4, 1, "2026-09-04T09:00:00.000Z"),
    ];
    expect(onePerPanelist(rows).map((r) => r.observationId)).toEqual([uuidFor(3), uuidFor(2)]);
    expect(onePerPanelist([...rows].reverse()).map((r) => r.observationId)).toEqual([
      uuidFor(3),
      uuidFor(2),
    ]);
  });

  it("breaks an observedAt tie on receivedAt, then observationId, in either input order", () => {
    const at = "2026-09-04T10:00:00.000Z";
    const a = row(1, 1, at, "2026-09-04T10:05:00.000Z");
    const b = row(2, 1, at, "2026-09-04T10:06:00.000Z");
    const c = row(3, 1, at, "2026-09-04T10:06:00.000Z");
    expect(onePerPanelist([a, b]).map((r) => r.observationId)).toEqual([uuidFor(2)]);
    expect(onePerPanelist([b, a]).map((r) => r.observationId)).toEqual([uuidFor(2)]);
    expect(onePerPanelist([b, c]).map((r) => r.observationId)).toEqual([uuidFor(3)]);
    expect(onePerPanelist([c, b]).map((r) => r.observationId)).toEqual([uuidFor(3)]);
  });

  it("the vote that counts is the panelist's latest price", () => {
    const early = toRow(
      validObservation({
        observationId: uuidFor(1),
        panelistId: uuidFor(9),
        observedAt: "2026-09-04T10:00:00.000Z",
        facts: { ...validObservation().facts, price: { amountMinor: 199, currency: "USD" } },
      }),
      FIXED_NOW.toISOString(),
    );
    const late = toRow(
      validObservation({
        observationId: uuidFor(2),
        panelistId: uuidFor(9),
        observedAt: "2026-09-04T11:00:00.000Z",
        facts: { ...validObservation().facts, price: { amountMinor: 299, currency: "USD" } },
      }),
      FIXED_NOW.toISOString(),
    );
    expect(onePerPanelist([early, late]).map((r) => r.priceMinor)).toEqual([299]);
  });
});

describe("queryCell", () => {
  it("re-filters rows the repo returned outside the window", () => {
    const stale = toRow(
      validObservation({
        observationId: uuidFor(1),
        observedAt: new Date(FIXED_NOW.getTime() - 100 * HOUR).toISOString(),
      }),
      FIXED_NOW.toISOString(),
    );
    const body = queryCell(BANANAS, [stale], FIXED_NOW);
    expect(body.observations).toBe(0);
    expect(body.resolution).toMatchObject({ status: "UNRESOLVED", reason: "no_observations" });
    expect(body.latestObservedAt).toBeNull();
  });
});

describe("parseCellKey", () => {
  it("accepts five parts with optional store id and zip3", () => {
    expect(parseCellKey(BANANAS)).toBe(BANANAS);
    expect(parseCellKey("walmart||2748189|pickup|")).toBe("walmart||2748189|pickup|");
  });

  it("rejects the wrong number of parts, empty required parts, and oversize keys", () => {
    expect(parseCellKey(undefined)).toBeUndefined();
    expect(parseCellKey("")).toBeUndefined();
    expect(parseCellKey("a|b|c|d")).toBeUndefined();
    expect(parseCellKey("a|b|c|d|e|f")).toBeUndefined();
    expect(parseCellKey("|b|c|d|e")).toBeUndefined();
    expect(parseCellKey("a|b||d|e")).toBeUndefined();
    expect(parseCellKey("a|b|c||e")).toBeUndefined();
    expect(parseCellKey(`a|b|c|d|${"e".repeat(600)}`)).toBeUndefined();
  });
});
