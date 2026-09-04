# ADR 0002: The observation schema is versioned, not frozen

**Status:** accepted, 2026-09-04

## Decision

`packages/schema` defines `PriceObservation`: one price, one panelist, one moment. It ships as
`0.1.0` now, gets revised against real scrubbed page fixtures in S03, and is tagged `1.0.0`
there. From `1.0.0` on:

- Any change bumps `SCHEMA_VERSION` and adds `docs/migrations/<version>.md` saying what
  changed and how existing rows are read.
- Additive optional fields are minor bumps. Anything else is major.
- Ingest stores `schemaVersion` on every row and rejects unknown versions.

## Design rules

1. **No PII.** `FORBIDDEN_KEYS` in the package is enforced before schema validation on both
   client and server. ZIP is 3 digits. Device is a class, never a user-agent string.
2. **Panelist id rotates.** Client-minted UUID, rotated on a schedule (S14 sets it). The server
   counts distinct observers per cell; it never needs a stable identity.
3. **Every candidate lever is context.** Fulfilment, session state, surface, zip3, device,
   clean-session. The stats engine's job is to attribute variance to levers; that is impossible
   if the levers were not recorded.
4. **Money is integer minor units.** Never floats.
5. **Provenance is mandatory.** Adapter and client versions plus an evidence hash of the scrubbed
   DOM fragment, so a bad adapter release can be quarantined by version and parses re-verified.

## Why not freeze in Sprint 0

You cannot know which fields matter before seeing the pages. The original plan froze first and
looked second. Freezing is a process (version, migrate, guard), not a moment.
