// Placeholder popup. The price ladder UI arrives in S11 (apps/extension/src/popup/**).
import { browser } from "wxt/browser";
import { hasConsent } from "../../lib/consent";
import { el, mount } from "../../lib/dom";
import { count } from "../../store";

async function render(): Promise<void> {
  const [consented, rows] = await Promise.all([hasConsent(), count()]);
  const options = el("button", { type: "button", text: "Options" });
  options.addEventListener("click", () => {
    void browser.runtime.openOptionsPage();
  });
  mount(
    el("section", {}, [
      el("h1", { text: "PennyPincher" }),
      el("p", {
        text: consented ? `On. ${rows} observations stored locally.` : "Off until you consent.",
      }),
      options,
    ]),
  );
}

void render();
