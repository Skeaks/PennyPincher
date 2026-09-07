/**
 * Consent state. Nothing in the extension may observe, store, or (in later sessions) send
 * anything until `hasConsent()` is true. See docs/decisions/0003-capture-posture.md, "Consent".
 *
 * Bump CONSENT_VERSION whenever the set of collected fields or the network behaviour the copy
 * describes changes. A stored consent whose
 * version differs from the current one is treated as absent, so the user is re-prompted.
 */
import { browser } from "wxt/browser";

/**
 * 2 (S06): the consent copy describes the anonymous logged-out page request.
 * 3 (S17): the copy says prices are also recorded from search, aisle and storefront tiles,
 * not only product pages.
 * 4 (S11): the copy says the records are uploaded to PennyPincher's own server every
 * 15 minutes and that the popup asks that server for the product's price ladder.
 */
export const CONSENT_VERSION = 4;
export const CONSENT_KEY = "pp:consent";

export interface ConsentRecord {
  version: number;
  /** ISO-8601 UTC timestamp of acceptance. */
  acceptedAt: string;
}

export class ConsentRequiredError extends Error {
  override readonly name = "ConsentRequiredError";
  constructor() {
    super("Consent has not been given for the current consent version.");
  }
}

function isConsentRecord(value: unknown): value is ConsentRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ConsentRecord).version === "number" &&
    typeof (value as ConsentRecord).acceptedAt === "string"
  );
}

/** The stored consent record, whatever its version, or null if none. */
export async function getConsent(): Promise<ConsentRecord | null> {
  const result = await browser.storage.local.get(CONSENT_KEY);
  const raw = result[CONSENT_KEY];
  return isConsentRecord(raw) ? raw : null;
}

/** True only when the user accepted the *current* consent version. */
export async function hasConsent(): Promise<boolean> {
  const record = await getConsent();
  return record !== null && record.version === CONSENT_VERSION;
}

/** Throws unless the current consent version has been accepted. Call at every capture boundary. */
export async function requireConsent(): Promise<void> {
  if (!(await hasConsent())) throw new ConsentRequiredError();
}

export async function acceptConsent(now: Date = new Date()): Promise<ConsentRecord> {
  const record: ConsentRecord = { version: CONSENT_VERSION, acceptedAt: now.toISOString() };
  await browser.storage.local.set({ [CONSENT_KEY]: record });
  return record;
}

export async function revokeConsent(): Promise<void> {
  await browser.storage.local.remove(CONSENT_KEY);
}
