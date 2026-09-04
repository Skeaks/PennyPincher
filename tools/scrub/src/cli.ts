/**
 * pnpm scrub <raw.html>... [--name X]...   scrub raw captures into fixtures/<retailer>/<slug>.html
 * pnpm scrub --check [dir] [--name X]...   fail if any committed fixture violates the guarantees
 *
 * Input paths are resolved from where you ran the command; output always goes to the repo's
 * `fixtures/` directory. `--name` is the recorder's first name or username and is never stored.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFixture, checkFixtureDir } from "./check.js";
import { metaTemplate } from "./meta.js";
import { scrubHtml } from "./scrub.js";

interface Args {
  check: boolean;
  names: string[];
  paths: string[];
  help: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { check: false, names: [], paths: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--check") args.check = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--name") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error("--name needs a value");
      args.names.push(v);
      i++;
    } else if (a.startsWith("--name=")) args.names.push(a.slice("--name=".length));
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else args.paths.push(a);
  }
  return args;
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

/** `fixtures/raw/<retailer>/<slug>.html` becomes `fixtures/<retailer>/<slug>.html`. */
export function outputPathFor(rawPath: string, fixturesDir: string): string {
  const retailer = basename(dirname(rawPath));
  return join(fixturesDir, retailer, basename(rawPath));
}

const USAGE = `usage:
  pnpm scrub fixtures/raw/<retailer>/<slug>.html [...] [--name <first name>]...
  pnpm scrub --check [fixtures/<retailer>] [--name <first name>]...`;

export function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const root = repoRoot();
  const fixturesDir = join(root, "fixtures");
  const invokedFrom = process.env.INIT_CWD ?? process.cwd();
  const opts = { names: args.names };

  if (args.check) {
    const target = args.paths[0] === undefined ? fixturesDir : resolve(invokedFrom, args.paths[0]);
    if (args.paths.length > 1) throw new Error("--check takes at most one directory");
    const failures = checkFixtureDir(target, opts);
    for (const f of failures) {
      process.stdout.write(`FAIL ${f.file}\n`);
      for (const p of f.problems) process.stdout.write(`  - ${p}\n`);
    }
    if (failures.length > 0) {
      process.stdout.write(`scrub --check: ${failures.length} file(s) failed\n`);
      return 1;
    }
    process.stdout.write("scrub --check: clean\n");
    return 0;
  }

  if (args.paths.length === 0) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  let exit = 0;
  for (const p of args.paths) {
    const rawPath = resolve(invokedFrom, p);
    const outPath = outputPathFor(rawPath, fixturesDir);
    const retailer = basename(dirname(outPath));
    const slug = basename(outPath, ".html");

    const html = readFileSync(rawPath, "utf8");
    const scrubbed = scrubHtml(html, opts);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, scrubbed, "utf8");

    const metaPath = join(dirname(outPath), `${slug}.meta.json`);
    let metaNote = "";
    if (!existsSync(metaPath)) {
      writeFileSync(metaPath, `${JSON.stringify(metaTemplate(retailer, slug), null, 2)}\n`);
      metaNote = ` (wrote ${basename(metaPath)} template; fill it from CAPTURE-LOG.md)`;
    }

    const inKb = Math.round(Buffer.byteLength(html, "utf8") / 1024);
    const outKb = Math.round(Buffer.byteLength(scrubbed, "utf8") / 1024);
    process.stdout.write(
      `${p} -> fixtures/${retailer}/${slug}.html ${inKb} KB -> ${outKb} KB${metaNote}\n`,
    );

    const problems = checkFixture(outPath, opts);
    for (const problem of problems) process.stdout.write(`  ! ${problem}\n`);
    if (problems.length > 0) exit = 1;
  }
  return exit;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`scrub: ${(e as Error).message}\n`);
    process.exitCode = 2;
  }
}
