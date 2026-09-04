/**
 * The rotating pseudonymous panelist id (schema: `panelistId`). Minted client-side, stored
 * next to the observations, replaced after PANELIST_ROTATION_MS so records cannot be tied
 * together for long. Never derived from anything about the user or the browser.
 *
 * S14 owns the rotation policy proper (and the server side of it); this is the minimum a valid
 * observation needs. Nothing else reads the record.
 */
import { browser } from "wxt/browser";

export const PANELIST_KEY = "pp:panelist";
export const PANELIST_ROTATION_MS = 7 * 24 * 60 * 60 * 1000;

export interface PanelistRecord {
  id: string;
  /** ISO-8601 UTC. */
  mintedAt: string;
}

function isPanelistRecord(value: unknown): value is PanelistRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PanelistRecord).id === "string" &&
    typeof (value as PanelistRecord).mintedAt === "string"
  );
}

/** The current panelist id, minting or rotating one as needed. */
export async function getPanelistId(
  now: Date = new Date(),
  mint: () => string = () => crypto.randomUUID(),
): Promise<string> {
  const result = await browser.storage.local.get(PANELIST_KEY);
  const raw = result[PANELIST_KEY];
  if (isPanelistRecord(raw)) {
    const age = now.getTime() - Date.parse(raw.mintedAt);
    if (Number.isFinite(age) && age >= 0 && age < PANELIST_ROTATION_MS) return raw.id;
  }
  const record: PanelistRecord = { id: mint(), mintedAt: now.toISOString() };
  await browser.storage.local.set({ [PANELIST_KEY]: record });
  return record.id;
}
