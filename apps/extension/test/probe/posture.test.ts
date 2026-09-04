/**
 * The S06 posture (ADR 0003, line 2): exactly one source file in the extension makes a
 * network request, it is the probe's fetch, it runs with `credentials: "omit"`, and it never
 * follows a redirect. Everything else the S04 posture test forbids stays forbidden.
 *
 * This replaced the "no network" block of test/posture.test.ts, which pinned the S04 world
 * where nothing fetched at all (deleted in PR #16 on Jamie's decision, 2026-09-04).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PROBE_FETCH_INIT } from "../../src/probe/fetch";

const SRC = join(__dirname, "..", "..", "src");
const FETCH_FILE = "probe/fetch.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const SOURCE_FILES = walk(SRC)
  .filter((f) => /\.(ts|tsx|js|mjs|html)$/.test(f))
  .map((f) => ({ rel: relative(SRC, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));

describe("network posture after S06", () => {
  it("scans a non-empty source tree", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(10);
  });

  it(`exactly one file calls fetch, and it is ${FETCH_FILE}`, () => {
    const callers = SOURCE_FILES.filter((f) => /\bfetch\s*\(/.test(f.text)).map((f) => f.rel);
    expect(callers).toEqual([FETCH_FILE]);
  });

  it("the probe fetch omits credentials, skips the cache, and never follows redirects", () => {
    const text = SOURCE_FILES.find((f) => f.rel === FETCH_FILE)?.text ?? "";
    expect(text).toMatch(/credentials:\s*"omit"/);
    expect(text).toMatch(/redirect:\s*"manual"/);
    expect(text).toMatch(/cache:\s*"no-store"/);
    // The literal call site passes the pinned init object and nothing else.
    expect(text).toMatch(/fetch\(url,\s*PROBE_FETCH_INIT\)/);
    expect(PROBE_FETCH_INIT.credentials).toBe("omit");
    expect(PROBE_FETCH_INIT.redirect).toBe("manual");
  });

  const STILL_BANNED = [
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /\bsendBeacon\b/,
    /\bimportScripts\s*\(/,
    /credentials:\s*"include"/,
    /credentials:\s*"same-origin"/,
    /\bcookies?\b\s*[.:=]/,
    /document\.cookie/,
    /\bnavigator\.userAgent\b/,
  ];

  for (const file of SOURCE_FILES) {
    it(`${file.rel} uses no other network or session API`, () => {
      for (const pattern of STILL_BANNED) {
        expect(file.text).not.toMatch(pattern);
      }
    });
  }
});
