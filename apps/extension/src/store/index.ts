/**
 * Append-only local observation store on `chrome.storage.local`.
 *
 *  - Every row is validated against `@pennypincher/schema` and the PII key list before it is
 *    stored. An invalid row is rejected, never coerced.
 *  - Appends require current consent (`requireConsent`).
 *  - Capped at MAX_ROWS. When full, the oldest rows are dropped (FIFO).
 *  - Rows are never edited in place. The only mutations are append and clear-all.
 *  - Nothing here talks to the network. There is no fetch in this extension (S04).
 */
import {
  type PriceObservation,
  PriceObservation as PriceObservationSchema,
  SCHEMA_VERSION,
  findForbiddenKeys,
} from "@pennypincher/schema";
import { browser } from "wxt/browser";
import { getConsent, requireConsent } from "../lib/consent";

export const STORE_KEY = "pp:observations";
export const MAX_ROWS = 5000;

export class InvalidObservationError extends Error {
  override readonly name = "InvalidObservationError";
  constructor(readonly issues: string[]) {
    super(`Observation rejected: ${issues.join("; ")}`);
  }
}

/** Serialises writers so two concurrent appends cannot lose rows in the read-modify-write. */
let writeQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

async function readRows(): Promise<PriceObservation[]> {
  const result = await browser.storage.local.get(STORE_KEY);
  const raw = result[STORE_KEY];
  return Array.isArray(raw) ? (raw as PriceObservation[]) : [];
}

async function writeRows(rows: PriceObservation[]): Promise<void> {
  await browser.storage.local.set({ [STORE_KEY]: rows });
}

/** Validate an unknown value as an observation. Throws InvalidObservationError. */
export function validateObservation(input: unknown): PriceObservation {
  const forbidden = findForbiddenKeys(input);
  if (forbidden.length > 0) {
    throw new InvalidObservationError(forbidden.map((p) => `forbidden key at ${p}`));
  }
  const parsed = PriceObservationSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidObservationError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return parsed.data;
}

/**
 * Append one observation. Requires consent; validates; enforces the FIFO cap.
 * Resolves to the number of rows now stored.
 */
export async function append(input: unknown): Promise<number> {
  await requireConsent();
  const observation = validateObservation(input);
  return serialized(async () => {
    const rows = await readRows();
    rows.push(observation);
    const overflow = rows.length - MAX_ROWS;
    if (overflow > 0) rows.splice(0, overflow);
    await writeRows(rows);
    return rows.length;
  });
}

/** All stored rows, oldest first. A copy; mutating it does not touch storage. */
export async function list(): Promise<PriceObservation[]> {
  return [...(await readRows())];
}

export async function count(): Promise<number> {
  return (await readRows()).length;
}

/** Delete every stored observation. Consent is left untouched; see `revokeConsent`. */
export async function clear(): Promise<void> {
  await serialized(() => browser.storage.local.remove(STORE_KEY));
}

export interface ExportFile {
  exportedAt: string;
  schemaVersion: typeof SCHEMA_VERSION;
  consent: { version: number; acceptedAt: string } | null;
  observations: PriceObservation[];
}

/** Everything the extension holds about this user, as one JSON document. */
export async function exportAll(now: Date = new Date()): Promise<ExportFile> {
  const [observations, consent] = await Promise.all([list(), getConsent()]);
  return { exportedAt: now.toISOString(), schemaVersion: SCHEMA_VERSION, consent, observations };
}
