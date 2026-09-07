import { browser } from "wxt/browser";
import { OPTIONS_COPY as C } from "../../copy/strings";
import { deleteMyData, deleteOutcomeText } from "../../identity/delete";
import { CONSENT_PAGE } from "../../lib/bootstrap";
import { CONSENT_VERSION, getConsent, hasConsent, revokeConsent } from "../../lib/consent";
import { el, mount } from "../../lib/dom";
import { loadProbeState } from "../../probe/state";
import { probeSummaryElement } from "../../probe/summary";
import { count, exportAll } from "../../store";

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
  if (consented && record) return C.consentGiven(record.acceptedAt.slice(0, 10));
  if (record) return C.consentStale(record.version, CONSENT_VERSION);
  return C.consentNone;
}

async function render(notice?: string): Promise<void> {
  const [consented, record, rows, probes] = await Promise.all([
    hasConsent(),
    getConsent(),
    count(),
    loadProbeState(),
  ]);

  const reviewButton = el("button", { type: "button", text: C.reviewButton });
  reviewButton.addEventListener("click", () => {
    window.location.assign(browser.runtime.getURL(CONSENT_PAGE));
  });

  const exportButton = el("button", { type: "button", text: C.exportButton });
  exportButton.addEventListener("click", () => {
    void downloadExport();
  });

  const deleteButton = el("button", {
    type: "button",
    class: "danger",
    text: C.deleteButton,
  }) as HTMLButtonElement;
  deleteButton.addEventListener("click", () => {
    deleteButton.disabled = true;
    void deleteMyData().then(
      (outcome) => render(deleteOutcomeText(outcome)),
      () => render(C.deleteUnexpected),
    );
  });

  const withdrawButton = el("button", {
    type: "button",
    class: "danger",
    text: C.withdrawButton,
  }) as HTMLButtonElement;
  withdrawButton.disabled = record === null;
  withdrawButton.addEventListener("click", () => {
    void revokeConsent().then(() => render());
  });

  mount(
    el("section", {}, [
      el("h1", { text: C.title }),
      el("dl", {}, [
        el("dt", { text: C.consentLabel }),
        el("dd", { id: "consent-status", text: consentStatusText(consented, record) }),
        el("dt", { text: C.storedLabel }),
        el("dd", { id: "row-count", text: C.storedRows(rows) }),
        el("dt", { text: C.sentLabel }),
        el("dd", { id: "sent-anywhere", text: C.sentAnywhere }),
      ]),
      el("div", { class: "row" }, [reviewButton, exportButton]),
      el("h2", { text: C.probesTitle }),
      el("p", { class: "muted", text: C.probesIntro }),
      probeSummaryElement(probes),
      el("h2", { text: C.deleteTitle }),
      el("p", { text: C.deleteIntro }),
      el("div", { class: "row" }, [deleteButton, withdrawButton]),
      ...(notice ? [el("p", { id: "delete-notice", class: "muted", text: notice })] : []),
    ]),
  );
}

void render();
