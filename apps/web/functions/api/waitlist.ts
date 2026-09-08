/**
 * `POST /api/waitlist`: the landing page's form target (S15). A Cloudflare Pages Function,
 * deployed with the static site, bound to the waitlist D1 database (wrangler.toml). It reads
 * the form, hands it to `src/waitlist.ts`, and answers with a 303 to the page that module
 * names. It reads nothing else from the request and logs nothing.
 */
import { type WaitlistStore, join } from "../../src/waitlist";

interface Env {
  WAITLIST_DB: D1Database;
}

class D1WaitlistStore implements WaitlistStore {
  constructor(private readonly db: D1Database) {}

  async add(email: string, joinedAt: string): Promise<"added" | "exists"> {
    const result = await this.db
      .prepare("INSERT OR IGNORE INTO waitlist (email, joined_at) VALUES (?1, ?2)")
      .bind(email, joinedAt)
      .run();
    return (result.meta.changes ?? 0) > 0 ? "added" : "exists";
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const outcome = await join(new D1WaitlistStore(env.WAITLIST_DB), form, new Date());
  return Response.redirect(new URL(outcome.location, request.url).toString(), 303);
};
