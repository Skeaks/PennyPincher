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
}
