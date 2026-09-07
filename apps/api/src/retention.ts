/**
 * Retention (S14, docs/data-retention.md). Raw observations are kept RAW_RETENTION_DAYS from
 * receipt, then deleted; abuse flags the same; rate-limit windows two hours. Runs from the
 * Worker's cron trigger (wrangler.toml, `[triggers]`) once a day. Idempotent and safe to run
 * any time: it only ever deletes what is already past the cutoff.
 */
import type { ObservationRepo, PurgeResult } from "./repo/observations";

export const RAW_RETENTION_DAYS = 90;
export const RAW_RETENTION_MS = RAW_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
/** Windows are an hour; the current and previous one are all a check can read. */
export const BUCKET_RETENTION_MS = 2 * 60 * 60 * 1_000;

export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RAW_RETENTION_MS);
}

export async function runRetention(
  repo: ObservationRepo,
  now: Date,
  log: (line: string) => void = (line) => console.log(line),
): Promise<PurgeResult> {
  const cutoff = retentionCutoff(now);
  const bucketCutoff = new Date(now.getTime() - BUCKET_RETENTION_MS);
  const result = await repo.purgeBefore(cutoff, bucketCutoff);
  log(JSON.stringify({ event: "retention_purge", cutoff: cutoff.toISOString(), ...result }));
  return result;
}
