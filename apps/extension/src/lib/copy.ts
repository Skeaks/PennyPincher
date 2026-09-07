/**
 * User-facing consent copy, in one place so it can be reviewed and versioned alongside
 * CONSENT_VERSION. Plain language. No regulated claims (CLAUDE.md rule 10).
 */
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
    "To check whether being signed in changes your price, the extension asks the retailer for the public page of the product you are viewing, the way a visitor who is not signed in would see it: without your cookies, sign-in, or any credentials. It does this at most once per product per hour, and if the retailer tries to send that request somewhere else it stops rather than follow.",
    "Every 15 minutes the records listed above are sent to PennyPincher's own server, under the rotating ID, so they can be pooled with other panelists' records. When you open the extension on a product, it asks that same server how the prices other panelists were shown for that product spread out. When you press \"Delete my data\", it asks that server to remove everything sent under your IDs. Those three requests and the page request above are the only network requests this version makes; none of them carries your cookies, sign-in, or anything that identifies you.",
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
