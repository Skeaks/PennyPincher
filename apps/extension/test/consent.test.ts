import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { CONSENT_COPY, NETWORK_REQUESTS, OPTIONS_COPY } from "../src/copy/strings";
import { CONSENT_PAGE, promptForConsentIfNeeded, registerLifecycle } from "../src/lib/bootstrap";
import {
  CONSENT_KEY,
  CONSENT_VERSION,
  ConsentRequiredError,
  acceptConsent,
  getConsent,
  hasConsent,
  requireConsent,
  revokeConsent,
} from "../src/lib/consent";
import { CONSENT_COPY as LEGACY_PATH_COPY } from "../src/lib/copy";
import { append, count } from "../src/store";
import { validObservation } from "./fixtures";

/** CLAUDE.md rule 10's words. Used by the copy tests below and the whole-tree scan at the end. */
const REGULATED = /\b(save|saves|saving|savings|cheapest|cheaper|lowest price|guarantee[sd]?)\b/i;

beforeEach(() => {
  fakeBrowser.reset();
});

describe("consent state", () => {
  it("starts absent", async () => {
    expect(await getConsent()).toBeNull();
    expect(await hasConsent()).toBe(false);
  });

  it("accept stores the current version and a timestamp", async () => {
    const now = new Date("2026-09-04T10:00:00.000Z");
    const record = await acceptConsent(now);
    expect(record).toEqual({ version: CONSENT_VERSION, acceptedAt: now.toISOString() });
    expect(await getConsent()).toEqual(record);
    expect(await hasConsent()).toBe(true);
  });

  it("revoke removes consent", async () => {
    await acceptConsent();
    await revokeConsent();
    expect(await hasConsent()).toBe(false);
  });

  it("a stored consent for an older version does not count", async () => {
    await fakeBrowser.storage.local.set({
      [CONSENT_KEY]: { version: CONSENT_VERSION - 1, acceptedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(await getConsent()).not.toBeNull();
    expect(await hasConsent()).toBe(false);
    await expect(requireConsent()).rejects.toBeInstanceOf(ConsentRequiredError);
  });

  it("garbage in storage is treated as no consent", async () => {
    await fakeBrowser.storage.local.set({ [CONSENT_KEY]: "yes" });
    expect(await getConsent()).toBeNull();
    expect(await hasConsent()).toBe(false);
  });
});

describe("consent gates the store", () => {
  it("append is refused without consent and stores nothing", async () => {
    await expect(append(validObservation())).rejects.toBeInstanceOf(ConsentRequiredError);
    expect(await count()).toBe(0);
  });

  it("append is refused when consent is for an older version", async () => {
    await fakeBrowser.storage.local.set({
      [CONSENT_KEY]: { version: CONSENT_VERSION - 1, acceptedAt: "2026-01-01T00:00:00.000Z" },
    });
    await expect(append(validObservation())).rejects.toBeInstanceOf(ConsentRequiredError);
    expect(await count()).toBe(0);
  });

  it("append works once consent is given, and stops again after revoke", async () => {
    await acceptConsent();
    expect(await append(validObservation())).toBe(1);
    await revokeConsent();
    await expect(append(validObservation())).rejects.toBeInstanceOf(ConsentRequiredError);
    expect(await count()).toBe(1);
  });
});

describe("consent prompt on install", () => {
  function opener() {
    const opened: string[] = [];
    const open = async (url: string) => {
      opened.push(url);
    };
    return { opened, open };
  }

  it("opens the consent page when there is no consent", async () => {
    const { opened, open } = opener();
    expect(await promptForConsentIfNeeded(open)).toBe(true);
    expect(opened).toEqual([fakeBrowser.runtime.getURL(CONSENT_PAGE)]);
  });

  it("does not open the consent page when current consent exists", async () => {
    await acceptConsent();
    const { opened, open } = opener();
    expect(await promptForConsentIfNeeded(open)).toBe(false);
    expect(opened).toEqual([]);
  });

  it("re-prompts when the stored consent is for an older CONSENT_VERSION", async () => {
    await fakeBrowser.storage.local.set({
      [CONSENT_KEY]: { version: CONSENT_VERSION - 1, acceptedAt: "2026-01-01T00:00:00.000Z" },
    });
    const { opened, open } = opener();
    expect(await promptForConsentIfNeeded(open)).toBe(true);
    expect(opened).toHaveLength(1);
  });

  it("the install and startup events trigger the prompt", async () => {
    const { opened, open } = opener();
    registerLifecycle(open);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "install" });
    await fakeBrowser.runtime.onStartup.trigger();
    // Listeners are fire-and-forget; let the promises settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened).toHaveLength(2);
  });
});

describe("consent copy", () => {
  const C = CONSENT_COPY;
  const all = [
    C.title,
    C.intro,
    ...C.collected,
    ...C.notCollected,
    ...C.howItWorks,
    C.deleteEverything,
    C.optInLabel,
    C.acceptButton,
    C.acceptedTitle,
    C.acceptedBody,
  ].join(" ");

  it("describes the anonymous logged-out page request the lever probe makes (S06)", () => {
    const how = C.howItWorks.join(" ");
    expect(how).toMatch(/public page of the product you are viewing/i);
    expect(how).toMatch(/not signed in/i);
    expect(how).toMatch(/without your cookies, sign-in, or any credentials/i);
    expect(how).toMatch(/at most once per product per hour/i);
    expect(how).toMatch(/stops rather than follow/i);
  });

  it("says prices are also recorded from search and aisle tiles, not only product pages (S17)", () => {
    expect(C.intro).toMatch(/search results and aisles/i);
    expect(C.collected.join(" ")).toMatch(/tile in search results or an aisle/i);
    expect(C.notCollected.join(" ")).toMatch(/product, search, aisle or storefront page/i);
    expect(all).not.toMatch(/not on a product page of a supported retailer/i);
    expect(CONSENT_VERSION).toBeGreaterThanOrEqual(3);
  });

  it("no longer claims the extension makes no network requests", () => {
    expect(all).not.toMatch(/no network requests/i);
  });

  it("is versioned: the probe copy is consent version 2 or later, so v1 users are re-asked", () => {
    expect(CONSENT_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("uses no regulated claim words", () => {
    expect(all).not.toMatch(REGULATED);
  });

  it("is still reachable at the S04 import path", () => {
    expect(LEGACY_PATH_COPY).toBe(CONSENT_COPY);
  });
});

/**
 * S15: the copy enumerates every request the extension makes, and the test fails when the
 * sync transport gains a request the copy does not describe (or the copy describes one the
 * transport no longer makes). The consent page lists them one per line; the options page's
 * "Sent anywhere" paragraph carries the same list.
 */
const SRC = join(__dirname, "..", "src");
const TRANSPORT_FILE = "sync/transport.ts";
const PROBE_FETCH_FILE = "probe/fetch.ts";

function readSource(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/** The source with block and line comments removed, so a path in a doc comment does not count. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every distinct `/v1/<segment>` path the transport requests, from its code, not its comments. */
function transportPaths(): string[] {
  const code = stripComments(readSource(TRANSPORT_FILE));
  return [...new Set(code.match(/\/v1\/[a-z-]+\/?/g) ?? [])].sort();
}

describe("consent copy enumerates every request (S15)", () => {
  const apiRequests = NETWORK_REQUESTS.filter((r) => r.to === "api");
  const retailerRequests = NETWORK_REQUESTS.filter((r) => r.to === "retailer");

  it("the transport requests exactly the API paths the copy lists, and no others", () => {
    const declared = apiRequests.map((r) => r.path).sort();
    const found = transportPaths();
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(found).toEqual(declared);
  });

  it("the transport's request helpers each carry a path from the list", () => {
    // A `fetch(` or `postJson(` call site that builds its URL from anything but a listed
    // path is a request the copy does not describe.
    const code = stripComments(readSource(TRANSPORT_FILE));
    const callSites = code.match(/\b(fetch|postJson)\s*\((?!\s*config: SyncConfig)[^;]*?;/g) ?? [];
    expect(callSites.length).toBeGreaterThanOrEqual(apiRequests.length);
    const nonHelper = callSites.filter(
      (site) => !/^fetch\(`\$\{config\.apiBaseUrl\}\$\{path\}`/.test(site),
    );
    for (const site of nonHelper) {
      expect(apiRequests.some((r) => r.path !== null && site.includes(r.path))).toBe(true);
    }
  });

  it("the retailer request is the probe's one fetch, and it is listed once", () => {
    expect(retailerRequests).toHaveLength(1);
    const probe = stripComments(readSource(PROBE_FETCH_FILE));
    expect(probe.match(/\bfetch\s*\(/g)).toHaveLength(1);
  });

  it("every request has a consent sentence and an options clause, in that order", () => {
    const how = CONSENT_COPY.howItWorks.join("\n");
    const sent = OPTIONS_COPY.sentAnywhere;
    let lastHow = -1;
    let lastSent = -1;
    for (const r of NETWORK_REQUESTS) {
      expect(r.copy.length).toBeGreaterThan(40);
      expect(r.short.length).toBeGreaterThan(20);
      const atHow = how.indexOf(r.copy);
      const atSent = sent.indexOf(r.short);
      expect(atHow).toBeGreaterThan(lastHow);
      expect(atSent).toBeGreaterThan(lastSent);
      lastHow = atHow;
      lastSent = atSent;
    }
    expect(how).toMatch(
      new RegExp(`Request ${NETWORK_REQUESTS.length} of ${NETWORK_REQUESTS.length}`),
    );
    expect(sent).toMatch(new RegExp(`\\(${NETWORK_REQUESTS.length}\\)`));
  });

  it("names the daily health upload as counts only, with no ids", () => {
    const health = NETWORK_REQUESTS.find((r) => r.path === "/v1/adapter-health");
    expect(health?.copy).toMatch(/once a day/i);
    expect(health?.copy).toMatch(/counts only/i);
    expect(health?.copy).toMatch(/no ID/);
  });

  it("names the ladder query and the delete call", () => {
    const how = CONSENT_COPY.howItWorks.join(" ");
    expect(how).toMatch(/when you open the extension on a product/i);
    expect(how).toMatch(/"Delete my data"/);
    expect(how).toMatch(/every 15 minutes/i);
    expect(how).toMatch(/every 7 days/i);
    expect(how).toMatch(/90 days/);
  });

  it("is consent version 6 or later, so version 5 users are re-asked", () => {
    expect(CONSENT_VERSION).toBeGreaterThanOrEqual(6);
  });

  it("the options page's paragraph uses no regulated claim words either", () => {
    expect(
      Object.values(OPTIONS_COPY)
        .filter((v) => typeof v === "string")
        .join(" "),
    ).not.toMatch(REGULATED);
  });
});

/**
 * S15: CLAUDE.md rule 10. No user-facing string anywhere in the extension may contain a
 * regulated claim word unless the line before it is exactly `// claims-reviewed`, the marker
 * Jamie adds together with the PR label of the same name. The copy file is scanned whole
 * (comments included); every other source file is scanned for string literals only, so an
 * identifier like `save` in code is not a claim.
 */
const MARKER = /^\s*\/\/ claims-reviewed\s*$/;
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const SOURCE_FILES = walk(SRC)
  .filter((f) => /\.(ts|html)$/.test(f))
  .map((f) => ({ rel: relative(SRC, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));

/** Lines (1-based) that carry a regulated word without a marker line right above them. */
function unreviewedLines(text: string, wholeLine: boolean): number[] {
  const lines = text.split("\n");
  const hits: number[] = [];
  lines.forEach((line, i) => {
    const subject = wholeLine ? line : (line.match(STRING_LITERAL) ?? []).join(" ");
    if (!REGULATED.test(subject)) return;
    if (i > 0 && MARKER.test(lines[i - 1] ?? "")) return;
    hits.push(i + 1);
  });
  return hits;
}

describe("regulated claim words (CLAUDE.md rule 10)", () => {
  it("scans a non-empty source tree that includes the copy file", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(10);
    expect(SOURCE_FILES.some((f) => f.rel === "copy/strings.ts")).toBe(true);
  });

  it("the marker exempts exactly the line after it", () => {
    expect(unreviewedLines('// claims-reviewed\nconst a = "you could save";', false)).toEqual([]);
    expect(unreviewedLines('const a = "you could save";', false)).toEqual([1]);
    expect(unreviewedLines('// claims-reviewed\n\nconst a = "you could save";', false)).toEqual([
      3,
    ]);
    expect(unreviewedLines("const save = 1;", false)).toEqual([]);
    expect(unreviewedLines("// we save nothing", true)).toEqual([1]);
  });

  for (const file of SOURCE_FILES) {
    it(`${file.rel} has no regulated word without a claims-reviewed marker`, () => {
      const wholeLine = file.rel.startsWith("copy/");
      expect(unreviewedLines(file.text, wholeLine)).toEqual([]);
    });
  }
});
