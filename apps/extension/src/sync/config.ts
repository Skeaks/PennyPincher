/**
 * Where the extension uploads to and what it presents (S11). Both come from build-time env
 * (`WXT_API_BASE_URL`, `WXT_PILOT_TOKEN`, see `.env.example`); the URL defaults to staging so
 * a plain `wxt build` talks to staging, and the token has no default because the pilot bearer
 * is a secret that never lives in the repository (S08). Without a token, sync and the ladder
 * query are simply off: nothing is sent, the popup says so.
 */

export interface SyncConfig {
  /** Origin of the API, no trailing slash. */
  apiBaseUrl: string;
  /** The pilot bearer. Empty means "not configured". */
  token: string;
}

/** The S08 staging Worker. Production is `pennypincher-api.jamesjlee04.workers.dev`. */
export const DEFAULT_API_BASE_URL = "https://pennypincher-api-staging.jamesjlee04.workers.dev";

function envString(name: string): string {
  const env = (import.meta as { env?: Record<string, unknown> }).env;
  const value = env?.[name];
  return typeof value === "string" ? value.trim() : "";
}

/** The build's config. Pure apart from reading `import.meta.env`. */
export function syncConfigFromEnv(): SyncConfig {
  const url = envString("WXT_API_BASE_URL") || DEFAULT_API_BASE_URL;
  return { apiBaseUrl: url.replace(/\/+$/, ""), token: envString("WXT_PILOT_TOKEN") };
}

export function isConfigured(config: SyncConfig): boolean {
  return config.token.length > 0 && /^https:\/\//.test(config.apiBaseUrl);
}
