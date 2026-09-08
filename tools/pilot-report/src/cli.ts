/**
 * pnpm --filter @pennypincher/pilot-report report <command>
 *
 *   query --week N [--env production|staging]
 *       Print the wrangler commands that export week N's rows and the abuse flags.
 *   week N --rows <export.json>... [--flags <flags.json>] [--api <url>] [--no-api]
 *       Write docs/pilot/week-N.md and week-N.json.
 *   skus --rows <export.json>... [--top 200]
 *       Write docs/pilot/skus.md: the pilot retailer's SKUs by observation count.
 *   reconcile --rows <export.json>... [--flags <flags.json>]
 *       Write docs/pilot/reconcile.md over the whole pilot window.
 *   decide --rows <export.json>... [--flags <flags.json>]
 *       Write docs/pilot/decision.md over the whole pilot window.
 *
 * Config: docs/pilot/pilot.json. Bearer: the PILOT_TOKEN environment variable (never a flag).
 * Paths are resolved from where the command was run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PanelistFlag } from "api/src/repo/observations";
import { type ApiClient, fetchClient } from "./api";
import { type PilotConfig, parsePilotConfig, pilotWindow, weekWindow } from "./config";
import { decide } from "./decide";
import { topSkus } from "./metrics";
import { reconcile } from "./reconcile";
import { renderDecision, renderReconcile, renderSkus, renderWeek } from "./render";
import { buildWeekReport, decisionInputs, summarize } from "./report";
import {
  type ExportRow,
  exportSql,
  flagsSql,
  inWindow,
  parseExport,
  parseFlags,
  wranglerCommand,
} from "./rows";

export interface Args {
  command: string | undefined;
  positional: string[];
  rows: string[];
  flags: string | undefined;
  api: string | undefined;
  noApi: boolean;
  week: number | undefined;
  top: number | undefined;
  env: string;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    command: undefined,
    positional: [],
    rows: [],
    flags: undefined,
    api: undefined,
    noApi: false,
    week: undefined,
    top: undefined,
    env: "production",
    help: false,
  };
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--no-api") args.noApi = true;
    else if (a === "--rows") args.rows.push(value(i++, a));
    else if (a === "--flags") args.flags = value(i++, a);
    else if (a === "--api") args.api = value(i++, a);
    else if (a === "--env") args.env = value(i++, a);
    else if (a === "--week") args.week = integer(value(i++, a), a);
    else if (a === "--top") args.top = integer(value(i++, a), a);
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else if (args.command === undefined) args.command = a;
    else args.positional.push(a);
  }
  if (args.env !== "production" && args.env !== "staging") {
    throw new Error("--env must be production or staging");
  }
  return args;
}

function integer(text: string, flag: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} must be a non-negative integer`);
  return n;
}

/** Walk up from this file until pnpm-workspace.yaml. */
export function repoRoot(from: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("could not find repo root (pnpm-workspace.yaml)");
    dir = parent;
  }
}

export interface CliDeps {
  /** Repo root; `docs/pilot/` lives under it. */
  root: string;
  /** Where relative `--rows` / `--flags` paths resolve from. */
  cwd: string;
  env: Record<string, string | undefined>;
  now: () => Date;
  /** Builds the API client; tests hand in the in-memory app. */
  client: (baseUrl: string, token: string | undefined) => ApiClient;
  stdout: (text: string) => void;
}

export const USAGE = `usage:
  report query --week N [--env production|staging]
  report week N --rows <export.json>... [--flags <flags.json>] [--api <url>] [--no-api]
  report skus --rows <export.json>... [--top 200]
  report reconcile --rows <export.json>... [--flags <flags.json>]
  report decide --rows <export.json>... [--flags <flags.json>]`;

export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  const args = parseArgs(argv);
  if (args.help || args.command === undefined) {
    deps.stdout(`${USAGE}\n`);
    return args.help ? 0 : 2;
  }
  const pilotDir = join(deps.root, "docs", "pilot");
  const config = loadConfig(join(pilotDir, "pilot.json"));

  switch (args.command) {
    case "query":
      return query(args, config, deps);
    case "week":
      return week(args, config, pilotDir, deps);
    case "skus":
      return skus(args, config, pilotDir, deps);
    case "reconcile":
      return reconcileCommand(args, config, pilotDir, deps);
    case "decide":
      return decideCommand(args, config, pilotDir, deps);
    default:
      throw new Error(`unknown command ${args.command}\n${USAGE}`);
  }
}

export function loadConfig(path: string): PilotConfig {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  const result = parsePilotConfig(JSON.parse(readFileSync(path, "utf8")));
  if (!result.ok) throw new Error(`${path}:\n  ${result.errors.join("\n  ")}`);
  return result.config;
}

function query(args: Args, config: PilotConfig, deps: CliDeps): number {
  if (args.week === undefined) throw new Error("query needs --week N");
  const window = weekWindow(config, args.week);
  const lines = [
    `# Week ${args.week}: ${window.from} to ${window.to}. Run from apps/api/; write the output to docs/pilot/raw/ (gitignored).`,
    `${wranglerCommand(exportSql(window), args.env)} > ../../docs/pilot/raw/week-${args.week}.rows.json`,
    `${wranglerCommand(flagsSql(), args.env)} > ../../docs/pilot/raw/week-${args.week}.flags.json`,
  ];
  deps.stdout(`${lines.join("\n")}\n`);
  return 0;
}

function readRows(args: Args, deps: CliDeps): ExportRow[] {
  if (args.rows.length === 0) throw new Error("at least one --rows <export.json> is required");
  const rows: ExportRow[] = [];
  const seen = new Set<string>();
  for (const path of args.rows) {
    for (const row of parseExport(readJson(resolve(deps.cwd, path)))) {
      // Two exports may overlap (a re-run, a widened window); an observation counts once.
      if (seen.has(row.observationId)) continue;
      seen.add(row.observationId);
      rows.push(row);
    }
  }
  return rows;
}

function readFlags(args: Args, deps: CliDeps): PanelistFlag[] {
  if (args.flags === undefined) return [];
  return parseFlags(readJson(resolve(deps.cwd, args.flags)));
}

function readJson(path: string): unknown {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function write(path: string, text: string, deps: CliDeps): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  deps.stdout(`wrote ${path}\n`);
}

async function week(args: Args, config: PilotConfig, pilotDir: string, deps: CliDeps) {
  const n = args.positional[0] === undefined ? args.week : integer(args.positional[0], "week");
  if (n === undefined) throw new Error("week needs a number: report week 1 --rows ...");
  const rows = readRows(args, deps);
  const flags = readFlags(args, deps);
  const api = args.noApi ? null : deps.client(args.api ?? config.apiBaseUrl, deps.env.PILOT_TOKEN);
  if (api && !deps.env.PILOT_TOKEN) {
    deps.stdout("PILOT_TOKEN is not set; the API will answer 401 unless it is open (local dev)\n");
  }
  const report = await buildWeekReport({ config, week: n, rows, flags, api, now: deps.now() });
  write(join(pilotDir, `week-${n}.md`), renderWeek(report), deps);
  write(join(pilotDir, `week-${n}.json`), `${JSON.stringify(report, null, 2)}\n`, deps);
  return 0;
}

function skus(args: Args, config: PilotConfig, pilotDir: string, deps: CliDeps): number {
  const window = pilotWindow(config);
  const rows = inWindow(readRows(args, deps), window);
  const page = {
    config,
    window,
    generatedAt: deps.now().toISOString(),
    skus: topSkus(rows, config.retailer, args.top ?? config.skuCount),
  };
  write(join(pilotDir, "skus.md"), renderSkus(page), deps);
  return 0;
}

function reconcileCommand(args: Args, config: PilotConfig, pilotDir: string, deps: CliDeps) {
  const window = pilotWindow(config);
  const summary = summarize(config, readRows(args, deps), readFlags(args, deps), window);
  const page = {
    config,
    window,
    generatedAt: deps.now().toISOString(),
    reconciliation: reconcile(summary.cells),
  };
  write(join(pilotDir, "reconcile.md"), renderReconcile(page), deps);
  return 0;
}

function decideCommand(args: Args, config: PilotConfig, pilotDir: string, deps: CliDeps) {
  const window = pilotWindow(config);
  const summary = summarize(config, readRows(args, deps), readFlags(args, deps), window);
  const inputs = decisionInputs(summary);
  const page = {
    config,
    window,
    generatedAt: deps.now().toISOString(),
    inputs,
    decision: decide(inputs, config.thresholds, config.counselReviewed),
  };
  write(join(pilotDir, "decision.md"), renderDecision(page), deps);
  deps.stdout(`verdict: ${page.decision.verdict}${page.decision.final ? "" : " (not final)"}\n`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), {
    root: repoRoot(),
    cwd: process.env.INIT_CWD ?? process.cwd(),
    env: process.env,
    now: () => new Date(),
    client: fetchClient,
    stdout: (text) => process.stdout.write(text),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`pilot-report: ${(e as Error).message}\n`);
      process.exitCode = 2;
    },
  );
}
