import { browser } from "wxt/browser";
import { CONSENT_PAGE } from "../../lib/bootstrap";
import { CONSENT_VERSION, getConsent, hasConsent, revokeConsent } from "../../lib/consent";
import { el, mount } from "../../lib/dom";
import { clear, count, exportAll } from "../../store";

function exportFilename(now: Date): string {
  return `pennypincher-export-${now.toISOString().slice(0, 10)}.json`;
}

/** Hands the user a JSON file via a temporary object URL. Needs no `downloads` permission. */
async function downloadExport(): Promise<void> {
  const now = new Date();
  const data = await exportAll(now);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const link = el("a", { href: url, download: exportFilename(now) });
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function consentStatusText(
  consented: boolean,
  record: { version: number; acceptedAt: string } | null,
) {
  if (consented && record) return `Given on ${record.acceptedAt.slice(0, 10)}.`;
  if (record) {
    return `Given for an earlier version (${record.version}); version ${CONSENT_VERSION} needs your review. The extension is off.`;
  }
  return "Not given. The extension is off.";
}

async function render(): Promise<void> {
  const [consented, record, rows] = await Promise.all([hasConsent(), getConsent(), count()]);

  const reviewButton = el("button", { type: "button", text: "Review consent" });
  reviewButton.addEventListener("click", () => {
    window.location.assign(browser.runtime.getURL(CONSENT_PAGE));
  });

  const exportButton = el("button", { type: "button", text: "Export my data" });
  exportButton.addEventListener("click", () => {
    void downloadExport();
  });

  const deleteButton = el("button", { type: "button", class: "danger", text: "Delete my data" });
  deleteButton.addEventListener("click", () => {
    void clear().then(render);
  });

  const withdrawButton = el("button", {
    type: "button",
    class: "danger",
    text: "Withdraw consent",
  }) as HTMLButtonElement;
  withdrawButton.disabled = record === null;
  withdrawButton.addEventListener("click", () => {
    void revokeConsent().then(render);
  });

  mount(
    el("section", {}, [
      el("h1", { text: "PennyPincher" }),
      el("dl", {}, [
        el("dt", { text: "Consent" }),
        el("dd", { id: "consent-status", text: consentStatusText(consented, record) }),
        el("dt", { text: "Stored on this computer" }),
        el("dd", { id: "row-count", text: `${rows} price observation${rows === 1 ? "" : "s"}` }),
        el("dt", { text: "Sent anywhere" }),
        el("dd", { text: "Nothing. This version makes no network requests." }),
      ]),
      el("div", { class: "row" }, [reviewButton, exportButton]),
      el("h2", { text: "Delete" }),
      el("p", {
        text: "Delete my data removes every observation stored on this computer. Withdraw consent turns the extension off until you agree again.",
      }),
      el("div", { class: "row" }, [deleteButton, withdrawButton]),
    ]),
  );
}

void render();
