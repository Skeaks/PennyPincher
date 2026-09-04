/**
 * Directory-level check over committed fixtures. Shared by the CLI (`--check`) and the gate
 * test, so what CI asserts is exactly what a recorder can run locally.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { FixtureMeta } from "./meta.js";
import { type ScrubOptions, checkHtml, visibleText } from "./scrub.js";

/**
 * Raw captures are 300 KB to 1.2 MB. Anything near that after scrubbing means stripping failed.
 * The brief said 200 KB; Walmart product pages strip to 175 to 305 KB because they carry about
 * 4,000 elements with utility-class attributes (class alone is ~40% of the output), so the
 * ceiling is 400 KB. Instacart and Target land at 45 to 65 KB.
 */
export const MAX_FIXTURE_BYTES = 400 * 1024;

export interface FileProblem {
  file: string;
  problems: string[];
}

/** Every committed fixture page under `dir`, skipping `raw/`. */
export function listFixturePages(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        if (name !== "raw" && name !== "node_modules") walk(p);
      } else if (name.endsWith(".html")) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out.sort();
}

export function metaPathFor(htmlPath: string): string {
  return join(dirname(htmlPath), `${basename(htmlPath, ".html")}.meta.json`);
}

/** Check one scrubbed page and its sidecar. Returns human-readable problems; empty is clean. */
export function checkFixture(htmlPath: string, opts: ScrubOptions = {}): string[] {
  const problems: string[] = [];
  const html = readFileSync(htmlPath, "utf8");

  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_FIXTURE_BYTES) {
    problems.push(`${bytes} bytes exceeds ${MAX_FIXTURE_BYTES}; stripping is not working`);
  }

  for (const v of checkHtml(html, opts)) {
    problems.push(`${v.rule} in ${v.where}: ${JSON.stringify(v.sample)}`);
  }

  const metaPath = metaPathFor(htmlPath);
  let metaRaw: string;
  try {
    metaRaw = readFileSync(metaPath, "utf8");
  } catch {
    problems.push(`missing sidecar ${basename(metaPath)}`);
    return problems;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(metaRaw);
  } catch (e) {
    problems.push(`${basename(metaPath)} is not JSON: ${(e as Error).message}`);
    return problems;
  }
  const parsed = FixtureMeta.safeParse(parsedJson);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${basename(metaPath)} ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    return problems;
  }
  const meta = parsed.data;

  const dirRetailer = basename(dirname(htmlPath));
  if (dirRetailer !== meta.retailer) {
    problems.push(`meta.retailer "${meta.retailer}" but file lives under "${dirRetailer}/"`);
  }
  const slug = basename(htmlPath, ".html");
  if (slug.endsWith("-logged-out") !== (meta.sessionState === "logged_out")) {
    problems.push(`slug "${slug}" and sessionState "${meta.sessionState}" disagree`);
  }

  const text = visibleText(html);
  if (!text.includes(meta.expected.priceText)) {
    const shown = JSON.stringify(meta.expected.priceText);
    problems.push(
      `expected price text ${shown} not present; the page may have been captured before the price rendered`,
    );
  }
  if (!text.includes(meta.expected.title)) {
    problems.push(`expected title ${JSON.stringify(meta.expected.title)} not present`);
  }
  const cents = Math.round(
    Number.parseFloat(meta.expected.priceText.replace(/[^0-9.]/g, "")) * 100,
  );
  if (Number.isFinite(cents) && cents !== meta.expected.price.amountMinor) {
    problems.push(
      `expected.priceText ${meta.expected.priceText} is ${cents} minor units, but ` +
        `expected.price.amountMinor is ${meta.expected.price.amountMinor}`,
    );
  }
  if (/\d{5}/.test(meta.store.label)) {
    problems.push(`store.label ${JSON.stringify(meta.store.label)} contains a full ZIP`);
  }
  return problems;
}

/** Check every page under `dir`. */
export function checkFixtureDir(dir: string, opts: ScrubOptions = {}): FileProblem[] {
  const out: FileProblem[] = [];
  for (const page of listFixturePages(dir)) {
    const problems = checkFixture(page, opts);
    if (problems.length > 0) out.push({ file: relative(dir, page), problems });
  }
  return out;
}
