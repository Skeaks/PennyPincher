/**
 * Instacart content script. Runs on every instacart.com page; the adapter's `matches` decides
 * whether the page is a product page. Passive: reads the DOM the user's browser already drew,
 * writes to the local store, and reports each stored observation to the background so the
 * lever probe (S06) can fetch the same page anonymously. It also parses the HTML the
 * background fetched, because only a content script has a DOM. All logic lives in src/capture
 * and src/probe.
 */
import { defineContentScript } from "wxt/utils/define-content-script";
import { defaultDeps, startCapture } from "../capture/run";
import { registerExtractHandler, reportOutcome } from "../probe/content";

export default defineContentScript({
  matches: ["*://*.instacart.com/*"],
  runAt: "document_idle",
  main() {
    registerExtractHandler();
    startCapture(window, defaultDeps(), {}, reportOutcome);
  },
});
