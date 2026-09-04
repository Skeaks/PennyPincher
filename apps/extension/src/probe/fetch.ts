/**
 * The one place in the extension that talks to the network, and the only request it makes: a
 * GET of the public product page the user is already looking at, with no credentials, no
 * cache, and no redirect following. This is the posture ADR 0003 (line 2) allows and nothing
 * more. `scripts/check-forbidden-api.sh` rejects any other credentials mode anywhere in the tree.
 *
 * Redirects are never followed: a logged-out visitor bounced to a sign-in page would otherwise
 * be parsed as a product page, and following one would tell the retailer where the user's
 * browser goes. With `redirect: "manual"` the response is opaque and the target is never seen.
 */

export const PROBE_FETCH_INIT = {
  credentials: "omit",
  cache: "no-store",
  redirect: "manual",
} as const satisfies RequestInit;

export type PageFetch =
  | { ok: true; html: string; status: number }
  | { ok: false; reason: "redirected" | "http_error" | "network_error"; detail?: string };

/** The parts of a Response the classifier reads, so a test can hand it a plain object. */
export interface ResponseLike {
  type: string;
  status: number;
  ok: boolean;
  text(): Promise<string>;
}

/** Turn a Response into a `PageFetch`. Pure apart from reading the body. */
export async function classifyResponse(response: ResponseLike): Promise<PageFetch> {
  if (
    response.type === "opaqueredirect" ||
    response.status === 0 ||
    (response.status >= 300 && response.status < 400)
  ) {
    return { ok: false, reason: "redirected" };
  }
  if (!response.ok) return { ok: false, reason: "http_error", detail: String(response.status) };
  try {
    return { ok: true, html: await response.text(), status: response.status };
  } catch (e) {
    return { ok: false, reason: "network_error", detail: e instanceof Error ? e.message : "" };
  }
}

/** Fetch `url` as an anonymous visitor. Never throws. */
export async function fetchLoggedOut(url: string): Promise<PageFetch> {
  try {
    const response = await fetch(url, PROBE_FETCH_INIT);
    return await classifyResponse(response);
  } catch (e) {
    return { ok: false, reason: "network_error", detail: e instanceof Error ? e.message : "" };
  }
}
