/**
 * Pins the manifest posture (S04): it asks for exactly the permissions the brief allows. The
 * network posture moved to test/probe/posture.test.ts in S06, when the lever probe became the
 * one file allowed to fetch (docs/decisions/0003-capture-posture.md, line 2). These are legal
 * constraints, so they are tests, not conventions.
 */
import { describe, expect, it } from "vitest";
import { HOST_PERMISSIONS, PERMISSIONS, manifest } from "../src/manifest";

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

  it("declares no content scripts in the manifest object (WXT registers them from src/entrypoints/*.content.ts)", () => {
    expect("content_scripts" in manifest).toBe(false);
  });
});
