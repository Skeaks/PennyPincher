import { CONSENT_VERSION, acceptConsent, hasConsent } from "../../lib/consent";
import { CONSENT_COPY as C } from "../../lib/copy";
import { el, list, mount } from "../../lib/dom";

function accepted(): HTMLElement {
  return el("section", {}, [
    el("h1", { text: C.acceptedTitle }),
    el("p", { text: C.acceptedBody }),
    el("p", { class: "muted", text: `Consent version ${CONSENT_VERSION}.` }),
  ]);
}

function form(onAccept: () => Promise<void>): HTMLElement {
  const checkbox = el("input", { type: "checkbox", id: "opt-in" }) as HTMLInputElement;
  const button = el("button", { type: "submit", text: C.acceptButton }) as HTMLButtonElement;
  button.disabled = true;
  checkbox.addEventListener("change", () => {
    button.disabled = !checkbox.checked;
  });

  const formEl = el("form", {}, [
    el("h1", { text: C.title }),
    el("p", { text: C.intro }),
    el("h2", { text: "What is recorded" }),
    list(C.collected),
    el("h2", { text: "What is never recorded" }),
    list(C.notCollected),
    el("h2", { text: "How it works" }),
    list(C.howItWorks),
    el("h2", { text: "Deleting everything" }),
    el("p", { text: C.deleteEverything }),
    el("label", { class: "opt-in", for: "opt-in" }, [checkbox, el("span", { text: C.optInLabel })]),
    button,
    el("p", { class: "muted", text: `Consent version ${CONSENT_VERSION}.` }),
  ]);
  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!checkbox.checked) return;
    button.disabled = true;
    void onAccept();
  });
  return formEl;
}

async function render(): Promise<void> {
  if (await hasConsent()) {
    mount(accepted());
    return;
  }
  mount(
    form(async () => {
      await acceptConsent();
      mount(accepted());
    }),
  );
}

void render();
