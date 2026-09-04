import { SCHEMA_VERSION } from "@pennypincher/schema";
import { describe, expect, it } from "vitest";
import { FIXED_NOW, testApp, uuidFor, validObservation } from "./fixtures";

describe("GET /healthz", () => {
  it("returns ok and the schema version", async () => {
    const { app } = testApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, schemaVersion: SCHEMA_VERSION });
  });
});

describe("POST /v1/observations", () => {
  it("stores a valid batch and returns 201 { accepted, duplicates }", async () => {
    const { repo, post } = testApp();
    const a = validObservation();
    const b = validObservation({
      observationId: uuidFor(2),
      context: { ...a.context, zip3: "100" },
    });

    const res = await post({ observations: [a, b] });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ accepted: 2, duplicates: 0 });
    expect(repo.rows.size).toBe(2);

    const stored = await repo.getById(a.observationId);
    expect(stored).toBeDefined();
    expect(stored?.cellKey).toBe("instacart|10769|2748189|delivery|085");
    expect(stored?.priceMinor).toBe(22);
    expect(stored?.isEstimate).toBe(true);
    expect(stored?.receivedAt).toBe(FIXED_NOW.toISOString());
    // raw_json is the validated payload, defaults applied, round-trippable.
    expect(JSON.parse(stored?.rawJson ?? "")).toEqual(a);

    expect((await repo.getById(b.observationId))?.cellKey).toBe(
      "instacart|10769|2748189|delivery|100",
    );
  });

  it("applies schema defaults before storing raw_json", async () => {
    const { repo, post } = testApp();
    const o = validObservation();
    const { isEstimate: _e, promoTags: _p, memberPrice: _m, ...facts } = o.facts;

    const res = await post({ observations: [{ ...o, facts }] });

    expect(res.status).toBe(201);
    const raw = JSON.parse((await repo.getById(o.observationId))?.rawJson ?? "");
    expect(raw.facts).toMatchObject({ isEstimate: false, promoTags: [], memberPrice: false });
  });

  it("rejects a batch carrying PII with 400 and the offending paths", async () => {
    const { repo, post } = testApp();
    const o = validObservation();
    const leaky = { ...o, context: { ...o.context, email: "someone@example.com" } };

    const res = await post({
      observations: [validObservation({ observationId: uuidFor(1) }), leaky],
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors).toEqual(["forbidden key at observations[1].context.email"]);
    // Nothing from a rejected batch is stored, not even the clean rows.
    expect(repo.rows.size).toBe(0);
  });

  it("counts duplicate ids instead of rejecting them", async () => {
    const { repo, post } = testApp();
    const a = validObservation();
    const b = validObservation({ observationId: uuidFor(2) });

    const first = await post({ observations: [a, b] });
    expect(await first.json()).toEqual({ accepted: 2, duplicates: 0 });

    // The whole batch resent (client retry after a lost response).
    const resent = await post({ observations: [a, b] });
    expect(resent.status).toBe(201);
    expect(await resent.json()).toEqual({ accepted: 0, duplicates: 2 });

    // Partial overlap plus a repeat inside the same batch.
    const c = validObservation({ observationId: uuidFor(3) });
    const mixed = await post({ observations: [a, c, c] });
    expect(mixed.status).toBe(201);
    expect(await mixed.json()).toEqual({ accepted: 1, duplicates: 2 });
    expect(repo.rows.size).toBe(3);
  });

  it("rejects an unknown schema version", async () => {
    const { repo, post } = testApp();
    const res = await post({ observations: [{ ...validObservation(), schemaVersion: "0.1.0" }] });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors.some((e) => e.startsWith("observations.0.schemaVersion:"))).toBe(true);
    expect(repo.rows.size).toBe(0);
  });

  it("rejects a batch over 200 observations", async () => {
    const { repo, post } = testApp();
    const observations = Array.from({ length: 201 }, (_, i) =>
      validObservation({ observationId: uuidFor(i + 1) }),
    );
    const res = await post({ observations });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors.some((e) => e.startsWith("observations:"))).toBe(true);
    expect(repo.rows.size).toBe(0);
  });

  it("accepts a batch of exactly 200", async () => {
    const { post } = testApp();
    const observations = Array.from({ length: 200 }, (_, i) =>
      validObservation({ observationId: uuidFor(i + 1) }),
    );
    const res = await post({ observations });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ accepted: 200, duplicates: 0 });
  });

  it("rejects an empty batch", async () => {
    const { post } = testApp();
    const res = await post({ observations: [] });
    expect(res.status).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    const { post } = testApp();
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: ["body must be a JSON ObservationBatch"] });
  });

  it("rejects a body that is not an ObservationBatch", async () => {
    const { post } = testApp();
    const res = await post({ hello: "world" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors.length).toBeGreaterThan(0);
  });
});

describe("unknown routes", () => {
  it("404 as JSON", async () => {
    const { app } = testApp();
    const res = await app.request("/v1/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ errors: ["not found"] });
  });
});
