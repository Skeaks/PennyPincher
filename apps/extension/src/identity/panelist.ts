/**
 * The rotating pseudonymous panelist id (schema: `panelistId`), S14. Minted client-side,
 * never derived from anything about the user or the browser, replaced every
 * PANELIST_ROTATION_MS so records cannot be tied together for long.
 *
 * Two storage keys. `pp:panelist` holds the current record `{ id, mintedAt }` (the S04 shape,
 * unchanged). `pp:panelist-history` holds the records retired by rotation, newest first, so
 * that "Delete my data" (`./delete.ts`) can ask the server to remove every id this browser
 * has used. PANELIST_IDS_KEPT ids are kept in total, the current one included.
 */
import { browser } from "wxt/browser";

export const PANELIST_KEY = "pp:panelist";
export const PANELIST_HISTORY_KEY = "pp:panelist-history";
export const PANELIST_ROTATION_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Current id plus the last twelve retired ones (S15). The server keeps a raw row for 90
 * days (docs/data-retention.md), which is 13 rotations of 7 days, so every id the server may
 * still hold a row under can be named for deletion. S14 shipped 4, its brief's number, and
 * recorded the gap.
 */
export const PANELIST_IDS_KEPT = 13;

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

function isFresh(record: PanelistRecord, now: Date): boolean {
  const age = now.getTime() - Date.parse(record.mintedAt);
  return Number.isFinite(age) && age >= 0 && age < PANELIST_ROTATION_MS;
}

async function readCurrent(): Promise<PanelistRecord | undefined> {
  const result = await browser.storage.local.get(PANELIST_KEY);
  const raw = result[PANELIST_KEY];
  return isPanelistRecord(raw) ? raw : undefined;
}

async function readHistory(): Promise<PanelistRecord[]> {
  const result = await browser.storage.local.get(PANELIST_HISTORY_KEY);
  const raw = result[PANELIST_HISTORY_KEY];
  return Array.isArray(raw) ? raw.filter(isPanelistRecord) : [];
}

/** The current panelist id, minting or rotating one as needed. */
export async function getPanelistId(
  now: Date = new Date(),
  mint: () => string = () => crypto.randomUUID(),
): Promise<string> {
  const current = await readCurrent();
  if (current && isFresh(current, now)) return current.id;

  const record: PanelistRecord = { id: mint(), mintedAt: now.toISOString() };
  const writes: Record<string, unknown> = { [PANELIST_KEY]: record };
  if (current && current.id !== record.id) {
    // Retire the old id: newest first, capped so the browser keeps PANELIST_IDS_KEPT in all.
    const history = [current, ...(await readHistory()).filter((r) => r.id !== current.id)];
    writes[PANELIST_HISTORY_KEY] = history.slice(0, PANELIST_IDS_KEPT - 1);
  }
  await browser.storage.local.set(writes);
  return record.id;
}

/** Every id this browser still remembers using: the current one first, then retired ones. */
export async function listPanelistIds(): Promise<string[]> {
  const [current, history] = await Promise.all([readCurrent(), readHistory()]);
  const ids: string[] = [];
  if (current) ids.push(current.id);
  for (const record of history) if (!ids.includes(record.id)) ids.push(record.id);
  return ids;
}

/** Forget every id. The next capture mints a fresh one. */
export async function clearPanelistIds(): Promise<void> {
  await browser.storage.local.remove([PANELIST_KEY, PANELIST_HISTORY_KEY]);
}
