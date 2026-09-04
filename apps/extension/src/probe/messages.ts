/**
 * The two messages the probe needs. Both stay inside the extension (content script <->
 * background); nothing here is sent to a page or a server.
 *
 *  - `pp:observed`: the content script tells the background it just stored an observation.
 *  - `pp:probe-extract`: the background hands fetched HTML back to the content script to
 *    parse. A service worker has no `DOMParser`; the content script does, and it already has
 *    the adapter. The HTML is a public page fetched without credentials.
 */
import type { PageContext } from "../capture/adapter";

export const OBSERVED = "pp:observed" as const;
export const PROBE_EXTRACT = "pp:probe-extract" as const;

export interface ObservedMessage {
  type: typeof OBSERVED;
  /** A `PriceObservation`; validated again by the receiver. */
  observation: unknown;
}

export interface ExtractRequest {
  type: typeof PROBE_EXTRACT;
  html: string;
  ctx: PageContext;
}

function hasType(value: unknown, type: string): value is { type: string } {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === type;
}

export function isObservedMessage(value: unknown): value is ObservedMessage {
  return hasType(value, OBSERVED) && "observation" in value;
}

export function isExtractRequest(value: unknown): value is ExtractRequest {
  return (
    hasType(value, PROBE_EXTRACT) &&
    typeof (value as ExtractRequest).html === "string" &&
    typeof (value as ExtractRequest).ctx === "object" &&
    (value as ExtractRequest).ctx !== null
  );
}
