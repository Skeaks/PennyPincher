/**
 * User-facing consent copy, in one place so it can be reviewed and versioned alongside
 * CONSENT_VERSION. Plain language. No regulated claims (CLAUDE.md rule 10).
 */
export const CONSENT_COPY = {
  title: "Before PennyPincher does anything",
  intro:
    "PennyPincher records the prices you are already shown while you shop on supported " +
    "retailer sites, so shoppers can see how those prices vary. It does nothing until you " +
    "agree below.",
  collected: [
    "The product you were looking at: its name, retailer item number, size text, and page address.",
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
    "Anything at all while you are not on a product page of a supported retailer.",
  ],
  howItWorks: [
    "The extension only reads what your browser already drew on the page. It never signs in, clicks, searches, or navigates for you.",
    "To check whether being signed in changes your price, the extension asks the retailer for the public page of the product you are viewing, the way a visitor who is not signed in would see it: without your cookies, sign-in, or any credentials. It does this at most once per product per hour, and if the retailer tries to send that request somewhere else it stops rather than follow.",
    "Everything stays on this computer. That page request is the only network request this version makes, and it carries nothing about you.",
  ],
  deleteEverything:
    'You can delete everything at any time. The extension\'s options page has a "Delete my data" ' +
    'button that removes every record stored on this computer, and an "Export my data" button ' +
    "that gives you a copy first if you want one. Removing the extension also deletes everything " +
    "it stored.",
  optInLabel: "I understand what is collected and what is not, and I agree to take part.",
  acceptButton: "Turn on PennyPincher",
  acceptedTitle: "Thank you",
  acceptedBody:
    "PennyPincher is on. You can review or withdraw this at any time from the extension's options page.",
} as const;
