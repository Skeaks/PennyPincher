/**
 * Pins the S04 posture: the manifest asks for exactly the permissions the brief allows, and no
 * source file in the extension can reach the network. These are legal constraints
 * (docs/decisions/0003-capture-posture.md), so they are tests, not conventions.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { HOST_PERMISSIONS, PERMISSIONS, manifest } from "../src/manifest";

const SRC = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const SOURCE_FILES = walk(SRC).filter((f) => /\.(ts|tsx|js|mjs|html)$/.test(f));

describe("manifest", () => {
  it("requests exactly storage and alarms", () => {
    expect([...(manifest.permissions ?? [])].sort()).toEqual(["alarms", "storage"]);
    expect([...PERMISSIONS].sort()).toEqual(["alarms", "storage"]);
  });

  it("never requests cookies, webRequest, tabs, scripting, or declarativeNetRequest", () => {
    const all = JSON.stringify(manifest);
    for (const banned of ["cookies", "webRequest", "tabs", "scripting", "declarativeNetRequest"]) {
      expect(all).not.toContain(`"${banned}"`);
    }
  });

  it("host permissions cover exactly instacart, target, walmart (subdomains allowed)", () => {
    expect([...(manifest.host_permissions ?? [])].sort()).toEqual([
      "*://*.instacart.com/*",
      "*://*.target.com/*",
      "*://*.walmart.com/*",
    ]);
    expect(manifest.host_permissions).toEqual(HOST_PERMISSIONS);
  });

  it("declares no content scripts (nothing reads a page until S05)", () => {
    expect("content_scripts" in manifest).toBe(false);
  });
});

describe("no network", () => {
  it("scans a non-empty source tree", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(5);
  });

  const NETWORK = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /\bsendBeacon\b/,
    /\bimportScripts\s*\(/,
  ];

  for (const file of SOURCE_FILES) {
    it(`${relative(SRC, file).replace(/\\/g, "/")} makes no network call`, () => {
      const text = readFileSync(file, "utf8");
      for (const pattern of NETWORK) {
        expect(text).not.toMatch(pattern);
      }
    });
  }
});
