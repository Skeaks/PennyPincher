# PennyPincher privacy policy

**Status: DRAFT (S15, 2026-09-07). Not yet reviewed by Jamie or counsel. Do not publish as
final.** Written for the closed pilot of 30 to 60 panelists; the public-launch version is a
separate review (S16 exit).

Bracketed items are for Jamie to fill: `[contact address]`, `[legal entity]`, `[state]`.

Every statement below is checked against the code it describes. The extension's consent copy
(`apps/extension/src/copy/strings.ts`, consent version 6), the retention document
(`docs/data-retention.md`), and this policy must agree; when they do not, the one that
describes the code wrong is fixed in the same PR as the code.

## 1. Who we are and what this covers

PennyPincher is a browser extension and a service run by `[legal entity]`, `[state]`. This
policy covers three things: the extension, the server the extension talks to, and the
waitlist form on the website. It covers nothing else; the website has no analytics, no
cookies, and no third-party scripts.

## 2. The short version

- The extension records the prices you were **already shown** on three retailers' websites,
  after you consent, and sends them to our server under a random ID that changes weekly.
- It never reads your retailer password, sign-in session, cookies, or payment details, and
  never signs in, clicks, searches, or navigates on your behalf. This is enforced by an
  automated check on every code change, not only by policy.
- Records are deleted 90 days after we receive them. You can delete them earlier, from the
  extension, at any time.
- The waitlist stores your email address and the time you joined, in a separate database
  used for nothing but pilot invitations.

## 3. What the extension records

The extension is off until you accept a consent screen that lists what follows. It then reads
prices from pages your browser has already drawn on `instacart.com`, `target.com`, and
`walmart.com`, on product pages and on the tiles of search results, aisle pages, and
storefront pages. It reads nothing on any other site, and nothing on other pages of those
sites.

Every record has exactly these fields. This list is the data contract
(`packages/schema`, version 1.1.0) and cannot change without a new consent version.

| Field | What it is | Where it comes from |
|---|---|---|
| `schemaVersion` | The version of this list | The extension |
| `observationId` | A random ID for the record | Minted by the extension |
| `panelistId` | A random ID for your browser, replaced every 7 days (section 6) | Minted by the extension |
| `observedAt` | When the price was seen, to the second, UTC | The extension's clock |
| `retailer` | `instacart`, `target`, or `walmart` | The page address |
| `store.retailerStoreId` | The retailer's number for the store serving you, when the page shows one | The page |
| `store.label` | The store's name as the page shows it (for example "Durham"). Never a street address | The page |
| `product.retailerSku` | The retailer's item number | The page |
| `product.upc` | The barcode number, when the page shows one | The page |
| `product.title` | The product name | The page |
| `product.brand` | The brand, when the page shows one | The page |
| `product.sizeText` | The size text (for example "1 gal") | The page |
| `product.url` | The product page address. Query strings are not stripped by the schema; the adapters record the address as shown, and a retailer address can carry tracking parameters. Flagged for counsel: see section 12 | The page address |
| `facts.price` | The price shown to you, in cents, USD | The page |
| `facts.priceText` | The price as printed | The page |
| `facts.isEstimate` | Whether the page marked the price as an estimate | The page |
| `facts.wasPrice` | A struck-through "was" price, when shown | The page |
| `facts.unitPriceText` | The unit price text, when shown | The page |
| `facts.promoTags` | Promo labels shown next to the price (for example "Sale") | The page |
| `facts.memberPrice` | Whether the price was marked as a member price | The page |
| `context.fulfillment` | `delivery`, `pickup`, or `ship`, whichever the page had selected | The page |
| `context.fulfillmentInferred` | True when the page showed no such control and the retailer's default was assumed | The extension |
| `context.sessionState` | Whether the page showed you as signed in, signed out, or neither could be told. **Not** whether you have an account, and nothing about the account | The page's header |
| `context.surface` | Desktop web or mobile web | The extension |
| `context.zip3` | The first three digits of the ZIP code the retailer was serving, when the page shows a ZIP (roughly a metro area) | The page |
| `context.device` | `desktop`, `mobile`, or `tablet` | The extension |
| `context.cleanSession` | True for the lever probe's anonymous view (section 4), absent otherwise | The extension |
| `provenance.adapter` | Which page reader produced the record, and its version | The extension |
| `provenance.clientVersion` | The extension's version | The extension |
| `provenance.evidenceHash` | A one-way hash of the price box's text, so a record can be checked against the page it came from. The text itself is not stored | The extension |

### What is never recorded

The data contract rejects any record containing any of these field names, at the extension
and again at the server: `email`, `password`, `passwd`, `token`, `cookie`, `cookies`,
`authorization`, `phone`, `address`, `firstName`, `lastName`, `fullName`, `userAgent`, `ip`,
`ipAddress`. Beyond the field names:

- Your name, email address, phone number, or street address.
- Your retailer password, sign-in session, cookies, or payment details. The extension has no
  permission to read cookies; the browser would refuse if it asked.
- Your full ZIP code, your IP address, or your browser's user-agent string.
- Anything typed into a page, anything in your cart, anything on an order or account page.
- Anything from any site other than the three retailers.

## 4. The lever probe: one request to the retailer

To show you whether being signed in is changing your price, the extension asks the retailer
for the public page of the product you are looking at, the way a visitor who is not signed in
would see it: **without your cookies, sign-in, or any credentials**, with no cache, and
refusing to follow any redirect (so a bounce to a sign-in page is discarded, and the retailer
never learns where the request would have gone). At most once per product per hour. The
anonymous price it finds is recorded like any other observation, marked `cleanSession`.

This request is the only thing the extension ever sends to a retailer. It never automates your
signed-in session, never calls a sign-in or account endpoint, and never uses a proxy or VPN.

## 5. What is sent to our server, and when

Four kinds of request, to our own server only, never with cookies or credentials, never
following redirects. This list is the consent copy's list; a test fails if the code makes a
request the list does not describe.

| When | What | Carries an ID? |
|---|---|---|
| Every 15 minutes | The records in section 3 that have not been sent yet, in batches of up to 200 | Yes, the rotating `panelistId` |
| When you open the popup on a product | A question: how do the prices other panelists saw for this product, store, delivery option and ZIP area spread out? The request names those four things | No |
| Once a day | Counts per page reader: pages attempted, pages read, pages that could not be read and why. No products, prices, addresses, or IDs | No |
| When you press "Delete my data" | A request to remove everything stored under each ID this browser has used | Yes, each ID |

Every request carries the pilot's shared access token, which identifies the pilot build, not
you. The server does not log request bodies, IP addresses, or user-agent strings. Cloudflare,
which hosts the server, sees the IP address of every request to it as part of carrying the
traffic; we do not receive or store it.

## 6. The rotating ID

Your browser mints a random ID (a UUID) with no connection to you, your browser, or your
retailer accounts, and replaces it every 7 days. Records sent under different IDs cannot be
tied together by us. The extension remembers the current ID and the twelve before it (13 in
all, which covers the 90-day retention period) so that "Delete my data" can name every ID the
server might still hold a record under.

The server uses the ID for three things: to count one vote per panelist when building a
price ladder, to rate-limit uploads, and to flag an ID whose prices are far outside what
every other panelist saw in the same place (a defence against bad data). A flagged ID's
records are left out of ladders until a person reviews the flag; they are never used for
anything else and are deleted on the same schedule as everything else.

## 7. How long we keep it

| Data | Kept | Then |
|---|---|---|
| Records from section 3 | 90 days from the day we receive them | Deleted by a daily job |
| Data-quality flags (section 6) | 90 days | Deleted by the same job |
| Rate-limit counters | 2 hours | Deleted by the same job |
| Daily page-reader counts (section 5) | Indefinitely. They carry no ID and no product | |
| Price ladders (the aggregate) | Indefinitely, once they exist. They carry counts and prices per product and store, never an ID | |
| Your email on the waitlist (section 10) | Until the pilot ends or you ask, whichever is first | Deleted by hand |

The retention job is automatic (`docs/data-retention.md`). It only ever deletes; running it
late or twice changes nothing.

## 8. Deleting your data

**In the extension.** The options page has "Export my data", which gives you a file with
every record on this computer, and "Delete my data", which asks our server to remove every
record stored under every ID this browser has used, and then, only if every one of those
requests succeeded, removes every record, price check and ID from this computer. If the
server cannot be reached, nothing is removed anywhere and the page says so, so you can try
again. Removing the extension deletes everything it stored on this computer; records already
on the server then expire on their own at 90 days.

**Ladders.** A price ladder you contributed to is recomputed from the remaining records the
next time it is requested; a cached copy can show the old answer for up to 60 seconds.

**Withdrawing consent** turns the extension off until you agree again. It does not delete
anything by itself; use "Delete my data" for that.

**Waitlist.** Reply to any message from us, or write to `[contact address]`, and we delete
the row.

## 9. Who can see it

Nobody outside `[legal entity]` sees individual records. Cloudflare hosts the server and the
database under its own terms. We do not sell records, share them with retailers, or use them
for advertising. Aggregate price ladders, which carry no ID, may be published or shared with
researchers, journalists, and regulators; that is the point of the panel, and the aggregate
cannot be traced to a panelist.

Legal process: if compelled, we can only hand over what we hold, which is the table in
section 3 under rotating IDs, and the waitlist emails. We hold nothing that links an ID to a
person.

## 10. The waitlist

The form on the website stores your email address (trimmed, lower-cased) and the time you
submitted it, in a database that holds nothing else and is separate from the panel's. It is
used to send pilot invitations and, during the pilot, notices about the pilot. It is never
joined to panel records; the panel has no email field to join it on. A second submission of
the same address changes nothing. The form reads no other field, and the server keeps no log
of the request.

## 11. Children

The pilot is for adults. We do not knowingly enrol anyone under 18 and will delete the records
of anyone we learn is.

## 12. Open questions for counsel

Recorded here so the reviewer sees them without reading the code.

1. `product.url` may carry retailer tracking parameters. Should the adapters strip the query
   string before recording? (A schema-side change; consent version bump.)
2. `product.title` and `store.label` are free text from the page. Nothing personal appears in
   the recorded fixtures, but a retailer could in principle print a name in a header the
   adapter reads. The adapters read specific elements, not the whole page.
3. The `sessionState` field records whether the page showed you as signed in. It is a lever
   the study measures, not an account attribute, but it is a fact about the panelist.
4. The pilot's shared access token is one token for the whole panel. It is not personal data,
   but a leaked token would let a stranger upload junk (rate-limited and flagged, not stopped).
5. Cloudflare as a processor: standard terms, US data location. Confirm no addendum is needed
   for a pilot of this size.

## 13. Changes

Any change to what is collected, how long it is kept, or the requests the extension makes
bumps the extension's consent version, and the extension turns itself off until you have read
and accepted the new text. This document is versioned in the repository; every change is
visible in its history.

## 14. Contact

`[contact address]`
