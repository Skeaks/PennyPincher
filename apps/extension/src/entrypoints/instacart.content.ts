/**
 * Instacart content script. Runs on every instacart.com page; the adapter's `matches` decides
 * whether the page is a product page. Passive: reads the DOM the user's browser already drew,
 * writes to the local store, and nothing else. All logic lives in src/capture.
 */
import { defineContentScript } from "wxt/utils/define-content-script";
import { defaultDeps, startCapture } from "../capture/run";

export default defineContentScript({
  matches: ["*://*.instacart.com/*"],
  runAt: "document_idle",
  main() {
    startCapture(window, defaultDeps());
  },
});
