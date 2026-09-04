/**
 * The request shape (the whole legal posture of the probe) and the response classifier. No
 * request is ever made here: `classifyResponse` takes a plain object.
 */
import { describe, expect, it } from "vitest";
import { PROBE_FETCH_INIT, classifyResponse } from "../../src/probe/fetch";

function response(overrides: Partial<Parameters<typeof classifyResponse>[0]> = {}) {
  return {
    type: "basic",
    status: 200,
    ok: true,
    text: async () => "<html></html>",
    ...overrides,
  };
}

describe("PROBE_FETCH_INIT", () => {
  it("omits credentials, skips the cache, and never follows a redirect", () => {
    expect(PROBE_FETCH_INIT).toEqual({
      credentials: "omit",
      cache: "no-store",
      redirect: "manual",
    });
  });
});

describe("classifyResponse", () => {
  it("returns the body of a 2xx", async () => {
    expect(await classifyResponse(response())).toEqual({
      ok: true,
      html: "<html></html>",
      status: 200,
    });
  });

  it("treats an opaque redirect as redirected, without reading a body", async () => {
    let read = 0;
    const r = response({
      type: "opaqueredirect",
      status: 0,
      ok: false,
      text: async () => {
        read += 1;
        return "";
      },
    });
    expect(await classifyResponse(r)).toEqual({ ok: false, reason: "redirected" });
    expect(read).toBe(0);
  });

  it("treats an explicit 3xx as redirected too", async () => {
    expect(await classifyResponse(response({ status: 302, ok: false }))).toEqual({
      ok: false,
      reason: "redirected",
    });
  });

  it("reports a 403 or 429 (bot check) as http_error with the status", async () => {
    expect(await classifyResponse(response({ status: 403, ok: false }))).toEqual({
      ok: false,
      reason: "http_error",
      detail: "403",
    });
    expect(await classifyResponse(response({ status: 429, ok: false }))).toEqual({
      ok: false,
      reason: "http_error",
      detail: "429",
    });
  });

  it("reports a body that cannot be read as network_error", async () => {
    const r = response({
      text: async () => {
        throw new Error("aborted");
      },
    });
    expect(await classifyResponse(r)).toEqual({
      ok: false,
      reason: "network_error",
      detail: "aborted",
    });
  });
});
