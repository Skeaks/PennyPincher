import type { InsertResult, ObservationRepo, ObservationRow } from "./observations";

/** In-memory repo for tests. Same idempotency semantics as D1's INSERT OR IGNORE. */
export class MemoryObservationRepo implements ObservationRepo {
  readonly rows = new Map<string, ObservationRow>();

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
    const fromMs = from.getTime();
    const toMs = to.getTime();
    return [...this.rows.values()]
      .filter((row) => {
        if (row.cellKey !== cellKey) return false;
        const t = Date.parse(row.observedAt);
        return t >= fromMs && t <= toMs;
      })
      .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  }
}
