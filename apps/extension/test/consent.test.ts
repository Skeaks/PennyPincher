import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
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
import { CONSENT_COPY } from "../src/lib/copy";
import { append, count } from "../src/store";
import { validObservation } from "./fixtures";

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

  it("no longer claims the extension makes no network requests", () => {
    expect(all).not.toMatch(/no network requests/i);
  });

  it("is versioned: the probe copy is consent version 2 or later, so v1 users are re-asked", () => {
    expect(CONSENT_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("uses no regulated claim words", () => {
    expect(all).not.toMatch(
      /\b(save|saves|saving|savings|cheapest|cheaper|lowest price|guarantee[sd]?)\b/i,
    );
  });
});
