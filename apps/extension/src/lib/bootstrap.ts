/**
 * What the background worker does on install, update, and browser start: nothing, except make
 * sure the user has seen the current consent screen. No capture, no alarms, no network until
 * consent exists (and capture itself does not exist until S05).
 */
import { browser } from "wxt/browser";
import { hasConsent } from "./consent";

export const CONSENT_PAGE = "/consent.html";

export type OpenPage = (url: string) => Promise<unknown>;

/** Default page opener: a new tab. `tabs.create` needs no `tabs` permission. */
export const openInTab: OpenPage = (url) => browser.tabs.create({ url });

/**
 * Opens the consent page unless the current consent version has already been accepted.
 * Returns true when the page was opened.
 */
export async function promptForConsentIfNeeded(open: OpenPage = openInTab): Promise<boolean> {
  if (await hasConsent()) return false;
  await open(browser.runtime.getURL(CONSENT_PAGE));
  return true;
}

/** Wires the install/startup listeners. Called once from the background entrypoint. */
export function registerLifecycle(open: OpenPage = openInTab): void {
  browser.runtime.onInstalled.addListener(() => {
    void promptForConsentIfNeeded(open);
  });
  browser.runtime.onStartup.addListener(() => {
    void promptForConsentIfNeeded(open);
  });
}
