# What a panelist consents to

**Status: DRAFT (S15, 2026-09-07). Not yet reviewed by Jamie or counsel.**

This is the consent text as a document: what the extension's consent screen says, why each
line is there, and how consent is recorded and withdrawn. The screen itself is rendered from
`apps/extension/src/copy/strings.ts` (`CONSENT_COPY`), consent version 6. The wording here is
the wording there; if the two drift, the code wins and this file is corrected.

## How consent works in the extension

1. On install, and on every browser start until it is given, the extension opens its consent
   page. Nothing is read, stored, or sent before the checkbox is ticked and the button pressed.
   Every capture and every upload path checks for consent first and refuses without it
   (`requireConsent`), so a bug elsewhere cannot capture without it.
2. Consent is recorded locally as a version number and a timestamp. Nothing about the consent
   is sent to the server; the server has no record of who consented, only records under
   rotating IDs.
3. Every change to what is collected or to the requests the extension makes bumps the version.
   A stored consent for an older version counts as no consent: the extension turns itself off
   and asks again with the new text. Version history is in `apps/extension/src/lib/consent.ts`.
4. Withdrawal: the options page's "Withdraw consent" turns the extension off until the user
   agrees again. "Delete my data" removes the records (privacy policy, section 8). Removing the
   extension does both locally.

## The screen, line by line

**Title.** "Before PennyPincher does anything"

**Intro.** "PennyPincher records the prices you are already shown while you shop on supported
retailer sites, on product pages and on the tiles of search results and aisles, so shoppers
can see how those prices vary. It does nothing until you agree below."

### What is recorded

Each line maps to fields of the data contract (privacy policy, section 3).

| Line | Fields |
|---|---|
| Each product whose price was shown to you, on its own page or as a tile in search results or an aisle: its name, retailer item number, size text, and page address. | `product.*` |
| The price shown to you, any struck-through price, unit price text, and promo labels. | `facts.*` |
| Which retailer and store, how you were getting the item (delivery, pickup, in store, shipped), and whether you appeared to be signed in. | `retailer`, `store.*`, `context.fulfillment`, `context.sessionState` |
| The first three digits of the ZIP code the retailer was serving, and whether you were on a desktop, phone, or tablet. | `context.zip3`, `context.device`, `context.surface` |
| A random ID for your browser that is replaced on a schedule, so records cannot be tied together for long. | `panelistId` |
| The extension and adapter version, so a faulty release can be found and discarded. | `provenance.*` |

### What is never recorded

- Your name, email address, phone number, or street address.
- Your retailer passwords, sign-in sessions, cookies, or payment details.
- Your full ZIP code, your IP address, or your browser's user-agent string.
- Anything from sites other than the supported retailers.
- Anything at all while you are not on a product, search, aisle or storefront page of a
  supported retailer.

### How it works

The list enumerates every network request the extension can make. A test
(`apps/extension/test/consent.test.ts`) reads the network code and fails if a request exists
that this list does not name, or the list names one that no longer exists.

1. The extension only reads what your browser already drew on the page. It never signs in,
   clicks, searches, or navigates for you.
2. It makes five kinds of network request, listed here in full, and no others.
3. Request 1 of 5, to the retailer: to check whether being signed in changes your price, the
   extension asks the retailer for the public page of the product you are viewing, the way a
   visitor who is not signed in would see it: without your cookies, sign-in, or any
   credentials. It does this at most once per product per hour, and if the retailer tries to
   send that request somewhere else it stops rather than follow.
4. Request 2 of 5, to PennyPincher's server: every 15 minutes, the records listed above are
   sent to PennyPincher's own server under the rotating ID, so they can be pooled with other
   panelists' records.
5. Request 3 of 5, to PennyPincher's server: when you open the extension on a product, it
   asks that same server how the prices other panelists were shown for that product spread
   out. That request names the product, store, and 3-digit ZIP area, and nothing about you.
6. Request 4 of 5, to PennyPincher's server: once a day, the extension tells that server how
   many pages it read on each retailer and how many it could not read, per version of the
   extension, so a broken release can be found. Counts only: no products, no prices, no page
   addresses, and no ID.
7. Request 5 of 5, to PennyPincher's server: when you press "Delete my data", it asks that
   server to remove everything sent under every ID this browser has used.
8. None of those requests carries your cookies, sign-in, or anything that identifies you.
9. The rotating ID changes every 7 days. The server keeps each record for 90 days, then
   deletes it.

### Deleting everything

"You can delete everything on this computer at any time. The extension's options page has a
"Delete my data" button that removes every record stored here, and an "Export my data" button
that gives you a copy first if you want one. "Delete my data" also asks PennyPincher's server
to remove every record sent under any ID this browser has used, and tells you whether that
worked. Removing the extension deletes everything it stored on this computer; records already
on the server then expire on their own after 90 days."

### The act of consent

Checkbox: "I understand what is collected and what is not, and I agree to take part."
Button: "Turn on PennyPincher". The button is disabled until the box is ticked. After:
"PennyPincher is on. You can review or withdraw this at any time from the extension's options
page." The consent version number is printed under the form.

## What consent does not cover, on purpose

- No research-study framing, no IRB language. This is a product pilot; if counsel wants study
  language (purpose, duration, risks, contact), it is added here and to the screen together.
- No age gate on the screen. The invitation goes to adults Jamie has spoken to; a public
  launch needs one (privacy policy, section 11).
- No email or name is asked for at consent. The waitlist email and the panel records are
  never joined, and consent does not change that.

## Version history

| Version | Session | Change |
|---|---|---|
| 1 | S04 | First screen: local-only capture, no network |
| 2 | S06 | The anonymous logged-out page request (lever probe) |
| 3 | S17 | Tiles on search, aisle and storefront pages, not only product pages |
| 4 | S11 | The 15-minute upload and the ladder query |
| 5 | S14 | The delete request, the 7-day rotation, the 90-day retention |
| 6 | S15 | Every request in one numbered list, including the daily health counts S12 added |
