/**
 * The content script's two probe duties. Neither touches the page the user is on.
 *
 *  1. After passive capture stores an observation, tell the background (`reportOutcome`).
 *  2. When the background hands back the HTML it fetched anonymously, parse it with
 *     `DOMParser` (a detached document: no window, no scripts run, no resources load) and run
 *     the same adapter over it (`handleExtractRequest`).
 */
import { browser } from "wxt/browser";
import type { ExtractResult } from "../capture/adapter";
import { ADAPTERS, findAdapter, runAdapter } from "../capture/registry";
import type { CaptureOutcome } from "../capture/run";
import { type ExtractRequest, OBSERVED, type ObservedMessage, isExtractRequest } from "./messages";

export type ParseHtml = (html: string) => Document;

/** Detached parse. `DOMParser` documents never load subresources or run scripts. */
export const parseWithDomParser: ParseHtml = (html) =>
  new DOMParser().parseFromString(html, "text/html");

export function handleExtractRequest(
  request: ExtractRequest,
  parse: ParseHtml = parseWithDomParser,
  adapters = ADAPTERS,
): ExtractResult {
  const adapter = findAdapter(request.ctx.url, adapters);
  if (!adapter) return { ok: false, reason: "not_product_page" };
  let doc: Document;
  try {
    doc = parse(request.html);
  } catch (e) {
    return { ok: false, reason: "adapter_threw", detail: e instanceof Error ? e.message : "" };
  }
  return runAdapter(adapter, doc, request.ctx);
}

export type SendMessage = (message: ObservedMessage) => Promise<unknown>;

/** Forward a stored observation to the background. Errors are swallowed: capture must not care. */
export function reportOutcome(
  outcome: CaptureOutcome,
  send: SendMessage = (m) => browser.runtime.sendMessage(m),
): void {
  if (outcome.status !== "stored") return;
  void send({ type: OBSERVED, observation: outcome.observation }).catch(() => undefined);
}

/** Answer extract requests from the background. Called once from the content-script entrypoint. */
export function registerExtractHandler(): void {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isExtractRequest(message)) return false;
    sendResponse(handleExtractRequest(message));
    return true;
  });
}
