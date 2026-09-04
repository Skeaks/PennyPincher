/** Worker bindings, mirroring wrangler.toml. Only D1 for now; the bearer token arrives in S08. */
export interface Env {
  DB: D1Database;
}
