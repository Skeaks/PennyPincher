/**
 * The network posture (ADR 0003, line 2). Exactly two source files in the extension make a
 * network request. The probe's fetch (S06) reads a retailer's public product page with
 * `credentials: "omit"` and never follows a redirect. The sync transport (S11) talks to
 * PennyPincher's own API only, at the configured origin, with `credentials: "omit"` and
 * redirects refused. Everything else the S04 posture test forbids stays forbidden.
 *
 * History: the S04 "no network" block of test/posture.test.ts became the one-file pin in
 * PR #16 (Jamie, 2026-09-04); the one-file pin became this two-file pin in PR #31 (Jamie,
 * 2026-09-07) when the upload arrived.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PROBE_FETCH_INIT } from "../../src/probe/fetch";
import { SYNC_FETCH_INIT } from "../../src/sync/transport";

const SRC = join(__dirname, "..", "..", "src");
const FETCH_FILE = "probe/fetch.ts";
const SYNC_FILE = "sync/transport.ts";
const FETCH_FILES = [FETCH_FILE, SYNC_FILE];

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

  it(`exactly two files call fetch: ${FETCH_FILE} and ${SYNC_FILE}`, () => {
    const callers = SOURCE_FILES.filter((f) => /\bfetch\s*\(/.test(f.text)).map((f) => f.rel);
    expect(callers.sort()).toEqual([...FETCH_FILES].sort());
  });

  it("the sync transport omits credentials, skips the cache, refuses redirects, and only talks to the configured API origin", () => {
    const text = SOURCE_FILES.find((f) => f.rel === SYNC_FILE)?.text ?? "";
    expect(text).toMatch(/credentials:\s*"omit"/);
    expect(text).toMatch(/redirect:\s*"error"/);
    expect(text).toMatch(/cache:\s*"no-store"/);
    // Every URL is built from config.apiBaseUrl; no literal host appears in the file.
    expect(text.match(/fetch\(`\$\{config\.apiBaseUrl\}/g)).toHaveLength(2);
    expect(text).not.toMatch(/https?:\/\//);
    expect(SYNC_FETCH_INIT.credentials).toBe("omit");
    expect(SYNC_FETCH_INIT.redirect).toBe("error");
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
