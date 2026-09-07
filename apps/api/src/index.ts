import { createApp } from "./app";
import type { Env } from "./env";
import { D1AdapterHealthRepo } from "./repo/adapter-health-d1";
import { D1ObservationRepo } from "./repo/d1";
import { runRetention } from "./retention";

/** Worker entry. wrangler.toml points `main` here; the Hono app exposes `fetch`. */
const app = createApp<Env>({
  repo: (env) => new D1ObservationRepo(env.DB),
  build: (env) => env.BUILD_SHA,
  pilotToken: (env) => env.PILOT_TOKEN,
  // The Workers cache API: GET /v1/cells answers live here for CELL_CACHE_SECONDS.
  cache: () => caches.default,
  adapterHealth: (env) => new D1AdapterHealthRepo(env.DB),
});

export default {
  fetch: app.fetch,
  /** The daily retention purge (S14): wrangler.toml `[triggers] crons`. */
  scheduled(_event, env, ctx) {
    ctx.waitUntil(runRetention(new D1ObservationRepo(env.DB), new Date()));
  },
} satisfies ExportedHandler<Env>;
