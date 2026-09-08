import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiClient } from "../src/api";
import { type CliDeps, loadConfig, main, parseArgs, repoRoot } from "../src/cli";
import { ladderRows, probeTwin, row, testConfig, wranglerJson } from "./helpers";

describe("parseArgs", () => {
  it("reads the command, positionals and repeated --rows", () => {
    const args = parseArgs(["week", "1", "--rows", "a.json", "--rows", "b.json", "--no-api"]);
    expect(args).toMatchObject({
      command: "week",
      positional: ["1"],
      rows: ["a.json", "b.json"],
      noApi: true,
      env: "production",
    });
    expect(parseArgs(["query", "--week", "2", "--env", "staging"])).toMatchObject({
      command: "query",
      week: 2,
      env: "staging",
    });
  });

  it("rejects unknown flags, bad integers and a bad env", () => {
    expect(() => parseArgs(["week", "--bogus"])).toThrow("unknown flag --bogus");
    expect(() => parseArgs(["skus", "--top", "many"])).toThrow(
      "--top must be a non-negative integer",
    );
    expect(() => parseArgs(["query", "--env", "prod"])).toThrow(
      "--env must be production or staging",
    );
    expect(() => parseArgs(["week", "--rows"])).toThrow("--rows needs a value");
  });
});

describe("main", () => {
  let root: string;
  let out: string[];
  let deps: CliDeps;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pilot-report-"));
    mkdirSync(join(root, "docs", "pilot"), { recursive: true });
    writeFileSync(join(root, "docs", "pilot", "pilot.json"), JSON.stringify(testConfig()));
    out = [];
    deps = {
      root,
      cwd: root,
      env: {},
      now: () => new Date("2026-09-21T09:00:00.000Z"),
      client: (): ApiClient => ({
        getJson: async () => ({ status: 503, body: null }),
      }),
      stdout: (text) => out.push(text),
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeExport(name: string, rows: ReturnType<typeof row>[]): string {
    const path = join(root, name);
    writeFileSync(path, JSON.stringify(wranglerJson(rows)));
    return path;
  }

  it("prints usage without a command and with --help", async () => {
    expect(await main([], deps)).toBe(2);
    expect(await main(["--help"], deps)).toBe(0);
    expect(out.join("")).toMatch(/usage:/);
  });

  it("query prints the two wrangler commands for the week", async () => {
    expect(await main(["query", "--week", "2"], deps)).toBe(0);
    const text = out.join("");
    expect(text).toContain("# Week 2: 2026-09-21T00:00:00.000Z to 2026-09-28T00:00:00.000Z");
    expect(text).toContain("observed_at >= '2026-09-21T00:00:00.000Z'");
    expect(text).toContain("> ../../docs/pilot/raw/week-2.rows.json");
    expect(text).toContain("FROM panelist_flags");
    expect(text).toContain("> ../../docs/pilot/raw/week-2.flags.json");
  });

  it("week writes the markdown and the JSON, offline", async () => {
    const mine = row({ observedAt: "2026-09-16T10:00:00.000Z" });
    const path = writeExport("w1.json", [
      ...ladderRows({ seed: "cli", n: 20, observers: 20 }),
      mine,
      probeTwin(mine, { priceMinor: 149 }),
    ]);
    expect(await main(["week", "1", "--rows", path, "--no-api"], deps)).toBe(0);
    const md = readFileSync(join(root, "docs", "pilot", "week-1.md"), "utf8");
    expect(md).toMatch(/^# Pilot week 1:/);
    expect(md).toContain("| panelists active | 21 | 21 |");
    const json = JSON.parse(readFileSync(join(root, "docs", "pilot", "week-1.json"), "utf8"));
    expect(json.week).toBe(1);
    expect(json.apiView).toBeNull();
    expect(json.probes[0].more).toBe(1);
    expect(out.join("")).toMatch(/wrote .*week-1\.md/);
  });

  it("week folds overlapping exports by observationId and warns without a token", async () => {
    const rows = ladderRows({ seed: "dup", n: 8 });
    const a = writeExport("a.json", rows.slice(0, 5));
    const b = writeExport("b.json", rows.slice(3));
    expect(await main(["week", "1", "--rows", a, "--rows", b], deps)).toBe(0);
    const json = JSON.parse(readFileSync(join(root, "docs", "pilot", "week-1.json"), "utf8"));
    expect(json.rows).toBe(8);
    expect(json.apiView.errors["instacart|10769|2748189|delivery|085"]).toBe(503);
    expect(out.join("")).toContain("PILOT_TOKEN is not set");
  });

  it("skus, reconcile and decide write their pages over the whole pilot", async () => {
    const path = writeExport("all.json", [
      ...ladderRows({ seed: "s-a", n: 30, observers: 30, sku: "a" }),
      ...ladderRows({
        seed: "s-b",
        n: 12,
        sku: "b",
        tiers: [500],
        startAt: "2026-09-23T12:00:00.000Z",
      }),
    ]);
    expect(await main(["skus", "--rows", path, "--top", "1"], deps)).toBe(0);
    const skus = readFileSync(join(root, "docs", "pilot", "skus.md"), "utf8");
    expect(skus).toContain("top 1 by observations");
    expect(skus).toContain("| 1 | a | Product a | 30 | 30 |");

    expect(await main(["reconcile", "--rows", path], deps)).toBe(0);
    const reconcile = readFileSync(join(root, "docs", "pilot", "reconcile.md"), "utf8");
    expect(reconcile).toContain("2 cells RESOLVED over the window");

    expect(await main(["decide", "--rows", path], deps)).toBe(0);
    const decision = readFileSync(join(root, "docs", "pilot", "decision.md"), "utf8");
    expect(decision).toContain("**Verdict: INCONCLUSIVE (not final).**");
    expect(out.join("")).toContain("verdict: INCONCLUSIVE (not final)");
  });

  it("refuses to run on a placeholder retailer, naming the file", async () => {
    writeFileSync(
      join(root, "docs", "pilot", "pilot.json"),
      JSON.stringify({ ...testConfig(), retailer: "Y" }),
    );
    await expect(main(["query", "--week", "1"], deps)).rejects.toThrow(
      /pilot\.json:\n {2}retailer: must be one of instacart, target, walmart/,
    );
  });

  it("needs --rows for anything but query", async () => {
    await expect(main(["week", "1", "--no-api"], deps)).rejects.toThrow(/at least one --rows/);
    await expect(main(["week", "1", "--rows", "nope.json", "--no-api"], deps)).rejects.toThrow(
      /missing .*nope\.json/,
    );
  });
});

describe("repo files", () => {
  it("the committed pilot.json parses, or fails only on the placeholder retailer", () => {
    const path = join(repoRoot(), "docs", "pilot", "pilot.json");
    expect(existsSync(path)).toBe(true);
    try {
      loadConfig(path);
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toMatch(/retailer: must be one of/);
      expect(message.split("\n")).toHaveLength(2);
    }
  });
});
