/** The D1 half of the adapter health repo (S12). Only the Worker entry imports this. */
import {
  type AdapterHealthRepo,
  type AdapterHealthRow,
  type HealthRecord,
  INSERT_HEALTH_SQL,
  SELECT_HEALTH_SINCE_SQL,
  fromHealthRecord,
  healthBindingsFor,
} from "../routes/adapter-health";

/** D1-backed repo. One report = one `db.batch()`, so a report lands whole or not at all. */
export class D1AdapterHealthRepo implements AdapterHealthRepo {
  constructor(private readonly db: D1Database) {}

  async insertMany(rows: AdapterHealthRow[]): Promise<void> {
    if (rows.length === 0) return;
    const insert = this.db.prepare(INSERT_HEALTH_SQL);
    await this.db.batch(rows.map((row) => insert.bind(...healthBindingsFor(row))));
  }

  async listSince(since: string): Promise<AdapterHealthRow[]> {
    const { results } = await this.db
      .prepare(SELECT_HEALTH_SINCE_SQL)
      .bind(since)
      .all<HealthRecord>();
    return results.map(fromHealthRecord);
  }
}
