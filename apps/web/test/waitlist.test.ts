import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX_LENGTH,
  FIELDS,
  REDIRECTS,
  type WaitlistStore,
  isValidEmail,
  join,
  normalizeEmail,
  parseSubmission,
} from "../src/waitlist";

function fields(entries: Record<string, unknown>) {
  const map = new Map(Object.entries(entries));
  return { get: (name: string) => map.get(name) ?? null };
}

/** An in-memory store that records what it was asked to add. */
function memoryStore(): WaitlistStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    async add(email, joinedAt) {
      if (rows.has(email)) return "exists";
      rows.set(email, joinedAt);
      return "added";
    },
  };
}

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    for (const ok of ["a@b.co", "jamie.lee+pilot@example.org", "x_y@sub.example.museum"]) {
      expect(isValidEmail(ok)).toBe(true);
    }
  });

  it("rejects the obvious non-addresses", () => {
    for (const bad of [
      "",
      "no-at-sign",
      "@nolocal.com",
      "two@@ats.com",
      "a@b@c.com",
      "nodot@domain",
      "trailing@dot.",
      "dot@.leading",
      "has space@example.com",
      `${"x".repeat(EMAIL_MAX_LENGTH)}@example.com`,
    ]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});

describe("parseSubmission", () => {
  it("trims and lower-cases the address", () => {
    expect(normalizeEmail("  Jamie@Example.COM ")).toBe("jamie@example.com");
    expect(parseSubmission(fields({ [FIELDS.email]: "  Jamie@Example.COM " }))).toEqual({
      ok: true,
      email: "jamie@example.com",
    });
  });

  it("reports a missing or blank address", () => {
    expect(parseSubmission(fields({}))).toEqual({ ok: false, reason: "missing" });
    expect(parseSubmission(fields({ [FIELDS.email]: "   " }))).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(parseSubmission(fields({ [FIELDS.email]: 42 }))).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("reports an invalid address", () => {
    expect(parseSubmission(fields({ [FIELDS.email]: "nope" }))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("a filled honeypot wins over everything else", () => {
    expect(
      parseSubmission(fields({ [FIELDS.email]: "real@example.com", [FIELDS.honeypot]: "x" })),
    ).toEqual({ ok: false, reason: "honeypot" });
  });

  it("an empty honeypot is ignored", () => {
    expect(
      parseSubmission(fields({ [FIELDS.email]: "real@example.com", [FIELDS.honeypot]: "  " })),
    ).toEqual({ ok: true, email: "real@example.com" });
  });
});

describe("join", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");

  it("stores the address with the time and sends the browser to the joined page", async () => {
    const store = memoryStore();
    const outcome = await join(store, fields({ [FIELDS.email]: "A@example.com" }), now);
    expect(outcome).toEqual({ stored: "added", location: REDIRECTS.joined });
    expect([...store.rows]).toEqual([["a@example.com", now.toISOString()]]);
  });

  it("a repeat address is 'exists', keeps the first time, and lands on the same page", async () => {
    const store = memoryStore();
    await join(store, fields({ [FIELDS.email]: "a@example.com" }), now);
    const later = new Date(now.getTime() + 60_000);
    const outcome = await join(store, fields({ [FIELDS.email]: "a@example.com" }), later);
    expect(outcome).toEqual({ stored: "exists", location: REDIRECTS.joined });
    expect(store.rows.get("a@example.com")).toBe(now.toISOString());
  });

  it("an invalid or missing address stores nothing and goes back to the form", async () => {
    const store = memoryStore();
    expect(await join(store, fields({ [FIELDS.email]: "nope" }), now)).toEqual({
      stored: "nothing",
      reason: "invalid",
      location: REDIRECTS.invalid,
    });
    expect(await join(store, fields({}), now)).toEqual({
      stored: "nothing",
      reason: "missing",
      location: REDIRECTS.invalid,
    });
    expect(store.rows.size).toBe(0);
  });

  it("a tripped honeypot stores nothing but looks like a join", async () => {
    const store = memoryStore();
    const outcome = await join(
      store,
      fields({ [FIELDS.email]: "bot@example.com", [FIELDS.honeypot]: "http://spam" }),
      now,
    );
    expect(outcome).toEqual({ stored: "nothing", reason: "honeypot", location: REDIRECTS.joined });
    expect(store.rows.size).toBe(0);
  });

  it("stores the email and the time, and nothing else", async () => {
    const seen: unknown[][] = [];
    const store: WaitlistStore = {
      async add(...args) {
        seen.push(args);
        return "added";
      },
    };
    await join(
      store,
      fields({ [FIELDS.email]: "a@example.com", name: "Jamie", ip: "203.0.113.1" }),
      now,
    );
    expect(seen).toEqual([["a@example.com", now.toISOString()]]);
  });
});

describe("the form target", () => {
  it("the redirect paths are relative, so they resolve against whichever origin serves the site", () => {
    for (const path of Object.values(REDIRECTS)) expect(path).toMatch(/^\//);
  });
});
