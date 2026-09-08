import type {
  DeleteResult,
  InsertResult,
  ObservationRepo,
  ObservationRow,
  PanelistFlag,
  PurgeResult,
  RateDemand,
} from "./observations";

/** In-memory repo for tests. Same idempotency semantics as D1's INSERT OR IGNORE. */
export class MemoryObservationRepo implements ObservationRepo {
  readonly rows = new Map<string, ObservationRow>();
  /** `${windowStart}|${key}` -> count. */
  readonly buckets = new Map<string, number>();
  readonly flags = new Map<string, PanelistFlag>();

  async insertMany(rows: ObservationRow[]): Promise<InsertResult> {
    let accepted = 0;
    for (const row of rows) {
      if (this.rows.has(row.observationId)) continue;
      this.rows.set(row.observationId, row);
      accepted += 1;
    }
    return { accepted, duplicates: rows.length - accepted };
  }

  async getById(observationId: string): Promise<ObservationRow | undefined> {
    return this.rows.get(observationId);
  }

  async listByCell(cellKey: string, from: Date, to: Date): Promise<ObservationRow[]> {
    return this.listWhere((row) => row.cellKey === cellKey, from, to);
  }

  async listByPanelist(panelistId: string, from: Date, to: Date): Promise<ObservationRow[]> {
    return this.listWhere((row) => row.panelistId === panelistId, from, to);
  }

  async listByCanonicalCell(
    canonicalCellKey: string,
    from: Date,
    to: Date,
  ): Promise<ObservationRow[]> {
    return this.listWhere(
      (row) => row.canonicalCellKey != null && row.canonicalCellKey === canonicalCellKey,
      from,
      to,
    );
  }

  private listWhere(
    match: (row: ObservationRow) => boolean,
    from: Date,
    to: Date,
  ): ObservationRow[] {
    const fromMs = from.getTime();
    const toMs = to.getTime();
    return [...this.rows.values()]
      .filter((row) => {
        if (!match(row)) return false;
        const t = Date.parse(row.observedAt);
        return t >= fromMs && t <= toMs;
      })
      .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  }

  async deletePanelist(panelistId: string): Promise<DeleteResult> {
    let observations = 0;
    for (const [id, row] of this.rows) {
      if (row.panelistId !== panelistId) continue;
      this.rows.delete(id);
      observations += 1;
    }
    this.flags.delete(panelistId);
    for (const key of [...this.buckets.keys()]) {
      if (key.endsWith(`|panelist:${panelistId}`)) this.buckets.delete(key);
    }
    return { observations };
  }

  async rateCounts(keys: readonly string[], windowStart: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const key of keys) out.set(key, this.buckets.get(`${windowStart}|${key}`) ?? 0);
    return out;
  }

  async rateAdd(demands: readonly RateDemand[], windowStart: string): Promise<void> {
    for (const { key, count } of demands) {
      const k = `${windowStart}|${key}`;
      this.buckets.set(k, (this.buckets.get(k) ?? 0) + count);
    }
  }

  async getFlags(panelistIds: readonly string[]): Promise<PanelistFlag[]> {
    const out: PanelistFlag[] = [];
    for (const id of panelistIds) {
      const flag = this.flags.get(id);
      if (flag) out.push(flag);
    }
    return out;
  }

  async flagPanelist(flag: PanelistFlag): Promise<boolean> {
    if (this.flags.has(flag.panelistId)) return false;
    this.flags.set(flag.panelistId, flag);
    return true;
  }

  async purgeBefore(cutoff: Date, bucketCutoff: Date): Promise<PurgeResult> {
    const result: PurgeResult = { observations: 0, flags: 0, buckets: 0 };
    const cutoffMs = cutoff.getTime();
    for (const [id, row] of this.rows) {
      if (Date.parse(row.receivedAt) < cutoffMs) {
        this.rows.delete(id);
        result.observations += 1;
      }
    }
    for (const [id, flag] of this.flags) {
      if (Date.parse(flag.flaggedAt) < cutoffMs) {
        this.flags.delete(id);
        result.flags += 1;
      }
    }
    const bucketMs = bucketCutoff.getTime();
    for (const key of [...this.buckets.keys()]) {
      const windowStart = key.slice(0, key.indexOf("|"));
      if (Date.parse(windowStart) < bucketMs) {
        this.buckets.delete(key);
        result.buckets += 1;
      }
    }
    return result;
  }
}
