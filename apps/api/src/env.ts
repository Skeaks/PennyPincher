/** Worker bindings, mirroring wrangler.toml plus what the deploy job injects. */
export interface Env {
  DB: D1Database;
  /**
   * Git SHA of the deployed build. deploy.yml passes it as `--var BUILD_SHA:<sha>` on every
   * `wrangler deploy`; absent under `wrangler dev`, where /healthz reports "dev".
   */
  BUILD_SHA?: string;
  /**
   * Pilot bearer token, set with `wrangler secret put PILOT_TOKEN --env <env>` and never
   * committed. When unset (local dev, tests) POST /v1/observations is open.
   */
  PILOT_TOKEN?: string;
}
