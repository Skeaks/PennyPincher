import { createApp } from "./app";
import type { Env } from "./env";
import { D1ObservationRepo } from "./repo/d1";

/** Worker entry. wrangler.toml points `main` here; the Hono app exposes `fetch`. */
export default createApp<Env>({
  repo: (env) => new D1ObservationRepo(env.DB),
  build: (env) => env.BUILD_SHA,
  pilotToken: (env) => env.PILOT_TOKEN,
});
