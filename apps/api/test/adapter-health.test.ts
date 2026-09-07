/**
 * The adapter health endpoints (S12) on the memory repo: a report lands as one row per
 * adapter, the GET sums the last 7 days per adapter and date, the bearer gates both, and the
 * body is rejected unless it is exactly counts and versions.
 */
import { describe, expect, it } from "vitest";
import migration from "../migrations/0002_adapter_health.sql?raw";
import { createApp } from "../src/app";
import { MemoryObservationRepo } from "../src/repo/memory";
import {
  ADAPTER_HEALTH_COLUMNS,
  type AdapterHealthEntry,
  type AdapterHealthReport,
  type AdapterHealthRow,
  type AdapterHealthSummary,
  HEALTH_DAYS,
  INSERT_HEALTH_SQL,
  MemoryAdapterHealthRepo,
  SELECT_HEALTH_SINCE_SQL,
  healthBindingsFor,
  parseAdapterHealthReport,
  sinceDate,
  summarize,
  toRows,
} from "../src/routes/adapter-health";
import { FIXED_NOW } from "./fixtures";

const PATH = "/v1/adapter-health";

/** The Target line every report starts from. */
function entry(): AdapterHealthEntry {
  return {
    adapter: "target",
    version: "0.1.0",
    attempted: 12,
    extracted: 10,
    failed: { no_price: 2 },
  };
}

function report(overrides: Partial<AdapterHealthReport> = {}): AdapterHealthReport {
  return {
    clientVersion: "0.1.0",
    date: "2026-09-04",
    adapters: [
      entry(),
      { adapter: "walmart", version: "0.1.0", attempted: 3, extracted: 3, failed: {} },
    ],
    ...overrides,
  };
}

function healthApp(now = FIXED_NOW, pilotToken?: string) {
  const health = new MemoryAdapterHealthRepo();
  const app = createApp<{ PILOT_TOKEN?: string }>({
    repo: () => new MemoryObservationRepo(),
    now: () => now,
    adapterHealth: () => health,
    ...(pilotToken === undefined ? {} : { pilotToken: (env) => env.PILOT_TOKEN }),
  });
  const post = (body: unknown, headers: Record<string, string> = {}, env = {}) =>
    app.request(
      PATH,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      env,
    );
  const get = (headers: Record<string, string> = {}, env = {}) =>
    app.request(PATH, { headers }, env);
  return { app, health, post, get };
}

function daysAgo(n: number, from = FIXED_NOW): string {
  return new Date(from.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

describe("POST /v1/adapter-health", () => {
  it("stores one row per adapter, stamped with the server time, and answers 201", async () => {
    const { health, post } = healthApp();
    const res = await post(report());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ stored: 2 });
    expect(health.rows).toEqual([
      {
        adapter: "target@0.1.0",
        clientVersion: "0.1.0",
        date: "2026-09-04",
        attempted: 12,
        extracted: 10,
        failed: { no_price: 2 },
        receivedAt: FIXED_NOW.toISOString(),
      },
      {
        adapter: "walmart@0.1.0",
        clientVersion: "0.1.0",
        date: "2026-09-04",
        attempted: 3,
        extracted: 3,
        failed: {},
        receivedAt: FIXED_NOW.toISOString(),
      },
    ]);
  });

  it("rejects a body that is not JSON", async () => {
    const { post } = healthApp();
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: ["body must be a JSON adapter health report"] });
  });

  it.each<[string, unknown]>([
    ["an array", [report()]],
    ["a missing date", { clientVersion: "0.1.0", adapters: report().adapters }],
    ["a date that is not a UTC calendar date", report({ date: "2026-09-04T00:00:00Z" })],
    ["a date that does not exist", report({ date: "2026-13-40" })],
    ["an empty adapters list", report({ adapters: [] })],
    ["a negative count", report({ adapters: [{ ...entry(), attempted: -1 }] })],
    ["a fractional count", report({ adapters: [{ ...entry(), extracted: 1.5 }] })],
    [
      "a count that is a string",
      report({ adapters: [{ ...entry(), attempted: "1" as unknown as number }] }),
    ],
    [
      "a failed count that is not a count",
      report({ adapters: [{ ...entry(), failed: { no_price: -3 } }] }),
    ],
    [
      "a reason that is not a reason",
      report({ adapters: [{ ...entry(), failed: { "https://x": 1 } }] }),
    ],
    [
      "an adapter name that is not an adapter name",
      report({ adapters: [{ ...entry(), adapter: "Target Inc." }] }),
    ],
    ["an empty version", report({ adapters: [{ ...entry(), version: "" }] })],
    ["a client version with spaces", report({ clientVersion: "0.1.0 beta" })],
  ])("rejects %s with 400 and stores nothing", async (_label, body) => {
    const { health, post } = healthApp();
    const res = await post(body);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { errors: string[] };
    expect(json.errors.length).toBeGreaterThan(0);
    expect(health.rows).toEqual([]);
  });

  it("rejects anything beyond counts and versions: observation data and ids are unexpected keys", async () => {
    const { health, post } = healthApp();
    for (const [body, key] of [
      [{ ...report(), observations: [] }, "observations"],
      [{ ...report(), panelistId: "0b1c2d3e-4f50-4a61-9b72-83c4d5e6f7a8" }, "panelistId"],
      [
        report({
          adapters: [{ ...entry(), url: "https://www.target.com/p/x" } as never],
        }),
        "url",
      ],
    ] as const) {
      const res = await post(body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { errors: string[] };
      expect(json.errors.join("\n")).toContain(`unexpected key "${key}"`);
    }
    expect(health.rows).toEqual([]);
  });

  it("caps the number of adapters and reasons", async () => {
    const { post } = healthApp();
    const many = Array.from({ length: 21 }, (_, i) => ({
      ...entry(),
      adapter: `adapter${i}`,
    }));
    expect((await post(report({ adapters: many }))).status).toBe(400);
    const reasons: Record<string, number> = {};
    for (let i = 0; i < 17; i++) reasons[`reason_${i}`] = 1;
    expect((await post(report({ adapters: [{ ...entry(), failed: reasons }] }))).status).toBe(400);
  });
});

describe("GET /v1/adapter-health", () => {
  it("is an empty list with nothing stored", async () => {
    const { get } = healthApp();
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("sums the rows of the last 7 days per adapter and date, sorted by adapter then date", async () => {
    const { post, get } = healthApp();
    // Two clients report the same day; one reports the day before; one reports a week ago.
    await post(report({ date: daysAgo(0) }));
    await post(report({ clientVersion: "0.1.1", date: daysAgo(0) }));
    await post(
      report({
        date: daysAgo(1),
        adapters: [
          {
            adapter: "target",
            version: "0.1.0",
            attempted: 5,
            extracted: 1,
            failed: { no_price: 3, no_title: 1 },
          },
        ],
      }),
    );
    await post(
      report({
        date: daysAgo(HEALTH_DAYS - 1),
        adapters: [
          { adapter: "instacart", version: "0.2.0", attempted: 1, extracted: 1, failed: {} },
        ],
      }),
    );
    await post(
      report({
        date: daysAgo(HEALTH_DAYS),
        adapters: [
          {
            adapter: "instacart",
            version: "0.1.0",
            attempted: 99,
            extracted: 0,
            failed: { adapter_threw: 99 },
          },
        ],
      }),
    );

    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdapterHealthSummary[];
    expect(body).toEqual([
      {
        adapter: "instacart@0.2.0",
        date: daysAgo(HEALTH_DAYS - 1),
        attempted: 1,
        extracted: 1,
        failed: {},
      },
      {
        adapter: "target@0.1.0",
        date: daysAgo(1),
        attempted: 5,
        extracted: 1,
        failed: { no_price: 3, no_title: 1 },
      },
      {
        adapter: "target@0.1.0",
        date: daysAgo(0),
        attempted: 24,
        extracted: 20,
        failed: { no_price: 4 },
      },
      { adapter: "walmart@0.1.0", date: daysAgo(0), attempted: 6, extracted: 6, failed: {} },
    ]);
  });

  it("keeps a bad release apart from the one before it (adapter is name@version)", async () => {
    const { post, get } = healthApp();
    await post(
      report({
        adapters: [
          { adapter: "target", version: "0.1.0", attempted: 10, extracted: 10, failed: {} },
        ],
      }),
    );
    await post(
      report({
        adapters: [
          {
            adapter: "target",
            version: "0.2.0",
            attempted: 10,
            extracted: 0,
            failed: { no_price: 10 },
          },
        ],
      }),
    );
    const body = (await (await get()).json()) as AdapterHealthSummary[];
    expect(body.map((line) => [line.adapter, line.extracted])).toEqual([
      ["target@0.1.0", 10],
      ["target@0.2.0", 0],
    ]);
  });
});

describe("/v1/adapter-health bearer token", () => {
  // Deliberately low-entropy so gitleaks does not flag a test fixture as a leaked secret.
  const TOKEN = "test-pilot-bearer";

  it("accepts the configured bearer on both methods", async () => {
    const { post, get } = healthApp(FIXED_NOW, TOKEN);
    const env = { PILOT_TOKEN: TOKEN };
    expect((await post(report(), { authorization: `Bearer ${TOKEN}` }, env)).status).toBe(201);
    expect((await get({ authorization: `Bearer ${TOKEN}` }, env)).status).toBe(200);
  });

  it("rejects a missing or wrong bearer with 401 on both methods, storing nothing", async () => {
    const { health, post, get } = healthApp(FIXED_NOW, TOKEN);
    const env = { PILOT_TOKEN: TOKEN };
    for (const headers of [{}, { authorization: `Bearer ${TOKEN}x` }, { authorization: TOKEN }]) {
      const posted = await post(report(), headers, env);
      expect(posted.status).toBe(401);
      expect(await posted.json()).toEqual({ errors: ["unauthorized"] });
      expect((await get(headers, env)).status).toBe(401);
    }
    expect(health.rows).toEqual([]);
  });

  it("is open when no token is configured (local dev)", async () => {
    const { post, get } = healthApp(FIXED_NOW, TOKEN);
    expect((await post(report(), {}, {})).status).toBe(201);
    expect((await get({}, {})).status).toBe(200);
  });

  it("is not mounted when the app has no health repo", async () => {
    const app = createApp<Record<string, never>>({
      repo: () => new MemoryObservationRepo(),
      now: () => FIXED_NOW,
    });
    expect((await app.request(PATH)).status).toBe(404);
    expect((await app.request(PATH, { method: "POST", body: "{}" })).status).toBe(404);
  });
});

describe("parseAdapterHealthReport", () => {
  it("accepts a well-formed report and drops nothing", () => {
    expect(parseAdapterHealthReport(report())).toEqual({ ok: true, report: report() });
  });

  it("names every problem, not just the first", () => {
    const parsed = parseAdapterHealthReport({ clientVersion: "", date: "x", adapters: "no" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual([
      "clientVersion: must be a version string",
      "date: must be a UTC calendar date, YYYY-MM-DD",
      "adapters: must be an array",
    ]);
  });
});

describe("summarize and sinceDate", () => {
  it("sinceDate is today minus HEALTH_DAYS - 1, in UTC", () => {
    expect(sinceDate(new Date("2026-09-07T00:30:00.000Z"))).toBe("2026-09-01");
    expect(sinceDate(new Date("2026-09-07T23:30:00.000Z"), 1)).toBe("2026-09-07");
  });

  it("drops rows before `since` and merges failure reasons", () => {
    const rows: AdapterHealthRow[] = [
      ...toRows(report({ date: "2026-09-01" }), "t"),
      ...toRows(
        report({
          date: "2026-09-02",
          adapters: [
            {
              adapter: "target",
              version: "0.1.0",
              attempted: 1,
              extracted: 0,
              failed: { no_title: 1 },
            },
          ],
        }),
        "t",
      ),
      ...toRows(
        report({
          date: "2026-09-02",
          adapters: [
            {
              adapter: "target",
              version: "0.1.0",
              attempted: 1,
              extracted: 0,
              failed: { no_price: 1 },
            },
          ],
        }),
        "t",
      ),
    ];
    expect(summarize(rows, "2026-09-02")).toEqual([
      {
        adapter: "target@0.1.0",
        date: "2026-09-02",
        attempted: 2,
        extracted: 0,
        failed: { no_title: 1, no_price: 1 },
      },
    ]);
  });
});

describe("D1 statement", () => {
  const tableColumns = (() => {
    const body =
      /CREATE TABLE IF NOT EXISTS adapter_health \(([^;]*)\);/.exec(migration)?.[1] ?? "";
    return body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("--"))
      .map((line) => line.split(/\s+/)[0] ?? "")
      .filter((name) => name !== "id");
  })();

  it("inserts exactly the columns the migration creates (id is the autoincrement)", () => {
    expect([...ADAPTER_HEALTH_COLUMNS].sort()).toEqual([...tableColumns].sort());
    expect(migration).toMatch(/id\s+INTEGER PRIMARY KEY AUTOINCREMENT/);
    expect(INSERT_HEALTH_SQL.startsWith("INSERT INTO adapter_health (")).toBe(true);
    expect(SELECT_HEALTH_SINCE_SQL).toContain("WHERE date >= ?1");
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS \w+\s+ON adapter_health \(date, adapter\)/,
    );
  });

  it("binds one value per column, failed as JSON", () => {
    const row = toRows(report(), FIXED_NOW.toISOString())[0];
    expect(row).toBeDefined();
    if (!row) return;
    const bindings = healthBindingsFor(row);
    expect(bindings).toHaveLength(ADAPTER_HEALTH_COLUMNS.length);
    expect(bindings[ADAPTER_HEALTH_COLUMNS.indexOf("adapter")]).toBe("target@0.1.0");
    expect(bindings[ADAPTER_HEALTH_COLUMNS.indexOf("failed_json")]).toBe('{"no_price":2}');
    expect(bindings[ADAPTER_HEALTH_COLUMNS.indexOf("received_at")]).toBe(FIXED_NOW.toISOString());
  });
});
