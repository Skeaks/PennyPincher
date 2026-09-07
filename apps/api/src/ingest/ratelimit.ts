/**
 * Ingest rate limit (S14): 1,000 observations per hour per bearer token and per panelistId,
 * counted in fixed one-hour windows. A batch that would push any bucket over the limit is
 * refused whole with 429 and nothing from it is stored or counted; the client's sync treats
 * that as a failed batch and backs off.
 *
 * Rows are counted as presented, duplicates included: the limit is an abuse cap, and a client
 * that keeps resending the same rows is exactly what it is for. A well-behaved extension
 * uploads at most every 15 minutes, so a legitimate panelist never gets near it.
 *
 * The token bucket is keyed on a SHA-256 prefix of the presented bearer, never the bearer
 * itself, so the table holds nothing that opens the API. With one pilot token the whole panel
 * shares one token bucket; that is the brief's number and the retro records the consequence.
 */
import type { ObservationRow, RateDemand } from "../repo/observations";

export const RATE_LIMIT_PER_HOUR = 1_000;
export const RATE_WINDOW_MS = 60 * 60 * 1_000;

/** The ISO instant the window containing `now` started (the top of the hour). */
export function windowStart(now: Date): string {
  return new Date(Math.floor(now.getTime() / RATE_WINDOW_MS) * RATE_WINDOW_MS).toISOString();
}

/** Whole seconds until the next window opens, at least 1: the `Retry-After` value. */
export function secondsUntilNextWindow(now: Date): number {
  const next = (Math.floor(now.getTime() / RATE_WINDOW_MS) + 1) * RATE_WINDOW_MS;
  return Math.max(1, Math.ceil((next - now.getTime()) / 1_000));
}

/** `token:<16 hex of sha256>` for a bearer; `token:open` when the API runs without one. */
export async function tokenKey(token: string | undefined): Promise<string> {
  if (!token) return "token:open";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `token:${hex.slice(0, 16)}`;
}

export function panelistKey(panelistId: string): string {
  return `panelist:${panelistId}`;
}

/** One demand for the token, one per panelistId in the batch. Pure. */
export function demandsFor(rows: readonly ObservationRow[], token: string): RateDemand[] {
  const perPanelist = new Map<string, number>();
  for (const row of rows) {
    const key = panelistKey(row.panelistId);
    perPanelist.set(key, (perPanelist.get(key) ?? 0) + 1);
  }
  return [
    { key: token, count: rows.length },
    ...[...perPanelist].map(([key, count]) => ({ key, count })),
  ];
}

/**
 * The first demand that would take its bucket past `limit`, or undefined when all fit. A
 * bucket already at the limit refuses even one more row; a batch is never partially counted.
 */
export function overLimit(
  counts: ReadonlyMap<string, number>,
  demands: readonly RateDemand[],
  limit: number = RATE_LIMIT_PER_HOUR,
): RateDemand | undefined {
  return demands.find((d) => (counts.get(d.key) ?? 0) + d.count > limit);
}

/** "token" or "panelist", for the error message. Never echoes the key. */
export function scopeOf(demand: RateDemand): "token" | "panelist" {
  return demand.key.startsWith("panelist:") ? "panelist" : "token";
}
