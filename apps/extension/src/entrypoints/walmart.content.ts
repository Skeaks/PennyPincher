/**
 * Walmart content script. A shim over `capture/run.ts`, like the Instacart one: runs on every
 * walmart.com page, the adapter's `matches` decides whether the page is a product page.
 * Passive: reads the DOM the user's browser already drew, writes to the local store, reports
 * each stored observation to the background for the lever probe (S06), parses the HTML the
 * background fetched, and counts every outcome for the adapter health beacon (S12).
 */
import { defineContentScript } from "wxt/utils/define-content-script";
import { recordCaptureOutcome } from "../capture/health";
import { findAdapter } from "../capture/registry";
import { defaultDeps, startCapture } from "../capture/run";
import { registerExtractHandler, reportOutcome } from "../probe/content";

export default defineContentScript({
  matches: ["*://*.walmart.com/*"],
  runAt: "document_idle",
  main() {
    registerExtractHandler();
    startCapture(window, defaultDeps(), {}, (outcome) => {
      reportOutcome(outcome);
      const adapter = findAdapter(window.location.href);
      void recordCaptureOutcome(outcome, adapter && `${adapter.name}@${adapter.version}`);
    });
  },
});
