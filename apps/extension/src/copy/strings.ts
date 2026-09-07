/**
 * Every user-facing string the extension shows, in one file (S15), so the copy can be
 * reviewed, versioned and tested as one thing. Plain language throughout.
 *
 * Two rules are enforced by test/consent.test.ts:
 *
 *  1. The network enumeration. NETWORK_REQUESTS lists every kind of request the extension can
 *     make, one entry per request, and `path` names the API path the sync transport uses for
 *     it. The test reads `src/sync/transport.ts` and fails if a `/v1/...` path appears there
 *     without an entry here, or here without a call site there. Adding a request means
 *     adding its sentence, and bumping CONSENT_VERSION (src/lib/consent.ts).
 *
 *  2. The regulated words of CLAUDE.md rule 10. No string in the extension may contain one
 *     unless the line before it is exactly `// claims-reviewed`, which only Jamie writes,
 *     alongside the `claims-reviewed` label on the PR that added it.
 */

/** Which party a request goes to. */
export type RequestTarget = "retailer" | "api";

export interface NetworkRequestCopy {
  to: RequestTarget;
  /** API path prefix as it appears in `src/sync/transport.ts`; null for the retailer request. */
  path: `/v1/${string}` | null;
  /** The consent page's sentence for this request. */
  copy: string;
  /** The options page's clause for this request, joined into one paragraph. */
  short: string;
}

/**
 * Every kind of network request this version of the extension can make, in the order the
 * consent page lists them. Nothing outside `src/probe/fetch.ts` (the retailer request) and
 * `src/sync/transport.ts` (the four API requests) may fetch; test/probe/posture.test.ts pins
 * that, and this list is the copy for it.
 */
export const NETWORK_REQUESTS: readonly NetworkRequestCopy[] = [
  {
    to: "retailer",
    path: null,
    copy:
      "To check whether being signed in changes your price, the extension asks the retailer " +
      "for the public page of the product you are viewing, the way a visitor who is not " +
      "signed in would see it: without your cookies, sign-in, or any credentials. It does " +
      "this at most once per product per hour, and if the retailer tries to send that " +
      "request somewhere else it stops rather than follow.",
    short:
      "the public page of the product you are viewing, requested from the retailer without " +
      "your sign-in or cookies, at most once an hour per product",
  },
  {
    to: "api",
    path: "/v1/observations",
    copy:
      "Every 15 minutes, the records listed above are sent to PennyPincher's own server " +
      "under the rotating ID, so they can be pooled with other panelists' records.",
    short:
      "the recorded prices, sent to PennyPincher's own server every 15 minutes under a " +
      "rotating ID",
  },
  {
    to: "api",
    path: "/v1/cells/",
    copy:
      "When you open the extension on a product, it asks that same server how the prices " +
      "other panelists were shown for that product spread out. That request names the " +
      "product, store, and 3-digit ZIP area, and nothing about you.",
    short:
      "when you open the popup on a product, a question to that server about how other " +
      "panelists' prices for that product spread out",
  },
  {
    to: "api",
    path: "/v1/adapter-health",
    copy:
      "Once a day, the extension tells that server how many pages it read on each retailer " +
      "and how many it could not read, per version of the extension, so a broken release " +
      "can be found. Counts only: no products, no prices, no page addresses, and no ID.",
    short:
      "once a day, counts of pages read and not read per retailer, with no products, " +
      "prices, addresses, or ID",
  },
  {
    to: "api",
    path: "/v1/panelists/",
    copy:
      'When you press "Delete my data", it asks that server to remove everything sent under ' +
      "every ID this browser has used.",
    short:
      'when you press "Delete my data", a request to remove everything sent under any ID ' +
      "this browser has used",
  },
];

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** "five" for 5; digits past nine, which would be a copy problem in its own right. */
export function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

function requestTarget(to: RequestTarget): string {
  return to === "retailer" ? "the retailer" : "PennyPincher's server";
}

const REQUEST_COUNT = countWord(NETWORK_REQUESTS.length);

/** The consent page (S04, revised each time the collected fields or network behaviour change). */
export const CONSENT_COPY = {
  title: "Before PennyPincher does anything",
  intro:
    "PennyPincher records the prices you are already shown while you shop on supported " +
    "retailer sites, on product pages and on the tiles of search results and aisles, so " +
    "shoppers can see how those prices vary. It does nothing until you agree below.",
  collected: [
    "Each product whose price was shown to you, on its own page or as a tile in search results or an aisle: its name, retailer item number, size text, and page address.",
    "The price shown to you, any struck-through price, unit price text, and promo labels.",
    "Which retailer and store, how you were getting the item (delivery, pickup, in store, shipped), and whether you appeared to be signed in.",
    "The first three digits of the ZIP code the retailer was serving, and whether you were on a desktop, phone, or tablet.",
    "A random ID for your browser that is replaced on a schedule, so records cannot be tied together for long.",
    "The extension and adapter version, so a faulty release can be found and discarded.",
  ],
  notCollected: [
    "Your name, email address, phone number, or street address.",
    "Your retailer passwords, sign-in sessions, cookies, or payment details.",
    "Your full ZIP code, your IP address, or your browser's user-agent string.",
    "Anything from sites other than the supported retailers.",
    "Anything at all while you are not on a product, search, aisle or storefront page of a supported retailer.",
  ],
  howItWorks: [
    "The extension only reads what your browser already drew on the page. It never signs in, clicks, searches, or navigates for you.",
    `It makes ${REQUEST_COUNT} kinds of network request, listed here in full, and no others.`,
    ...NETWORK_REQUESTS.map(
      (r, i) =>
        `Request ${i + 1} of ${NETWORK_REQUESTS.length}, to ${requestTarget(r.to)}: ${r.copy}`,
    ),
    "None of those requests carries your cookies, sign-in, or anything that identifies you.",
    "The rotating ID changes every 7 days. The server keeps each record for 90 days, then deletes it.",
  ],
  deleteEverything:
    "You can delete everything on this computer at any time. The extension's options page has a " +
    '"Delete my data" button that removes every record stored here, and an "Export my data" ' +
    'button that gives you a copy first if you want one. "Delete my data" also asks ' +
    "PennyPincher's server to remove every record sent under any ID this browser has used, and " +
    "tells you whether that worked. Removing the extension deletes everything it stored on this " +
    "computer; records already on the server then expire on their own after 90 days.",
  optInLabel: "I understand what is collected and what is not, and I agree to take part.",
  acceptButton: "Turn on PennyPincher",
  acceptedTitle: "Thank you",
  acceptedBody:
    "PennyPincher is on. You can review or withdraw this at any time from the extension's options page.",
} as const;

/** The options page (S04, S06, S14, S15). */
export const OPTIONS_COPY = {
  title: "PennyPincher",
  consentLabel: "Consent",
  consentGiven: (date: string) => `Given on ${date}.`,
  consentStale: (given: number, current: number) =>
    `Given for an earlier version (${given}); version ${current} needs your review. The extension is off.`,
  consentNone: "Not given. The extension is off.",
  storedLabel: "Stored on this computer",
  storedRows: (rows: number) => `${rows} price observation${rows === 1 ? "" : "s"}`,
  sentLabel: "Sent anywhere",
  /** The same enumeration as the consent page, as one paragraph. */
  sentAnywhere: [
    `Nothing that identifies you. This version makes ${REQUEST_COUNT} kinds of network request and no others:`,
    `${NETWORK_REQUESTS.map((r, i) => `(${i + 1}) ${r.short}`).join("; ")}.`,
    "None of them carries your cookies, sign-in, or anything that identifies you.",
  ].join(" "),
  reviewButton: "Review consent",
  exportButton: "Export my data",
  probesTitle: "Anonymous price checks",
  probesIntro:
    "Per retailer: checks run, price differences found, and checks that produced no anonymous price.",
  deleteTitle: "Delete",
  deleteIntro:
    "Delete my data asks PennyPincher's server to remove every record sent under any ID this browser has used, then removes every observation and price check stored on this computer. Withdraw consent turns the extension off until you agree again.",
  deleteButton: "Delete my data",
  withdrawButton: "Withdraw consent",
  deleteUnexpected: "Something went wrong and nothing was removed. Try again.",
} as const;
