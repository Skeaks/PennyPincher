# Chrome Web Store: the unlisted pilot listing

How the pilot build reaches panelists (S15). Jamie submits; agents produce the zip and keep
this file true. The listing is **unlisted**: anyone with the link can install, nobody finds it
by search, and Chrome updates it like any other extension, so a panelist never loads unpacked.

## 1. Build the upload

From the repo root, with the production API and the pilot token in `apps/extension/.env`
(copy `.env.example`; the token is the `PILOT_TOKEN` secret of the production Worker, never
committed):

```bash
pnpm --filter extension zip
```

Output: `apps/extension/.output/extension-<version>-chrome.zip` (version from
`apps/extension/package.json`; bump it before every submission, the store refuses a repeat).
The zip is the built `chrome-mv3/` directory: the manifest, three content scripts, the
background worker, the consent, options and popup pages. Check before uploading:

```bash
unzip -p apps/extension/.output/extension-*-chrome.zip manifest.json
```

The manifest must show `permissions: ["storage", "alarms"]`, the three retailer host
permissions, and nothing else. `test/posture.test.ts` pins this; the check is for the human.

## 2. Listing text

**Name:** PennyPincher

**Summary (132 characters max):**
Records the prices you were already shown on Instacart, Target and Walmart, with your consent,
so a panel can see how prices vary.

**Description:**

> PennyPincher is a closed pilot. It records the price your browser already drew on the page
> while you shop on Instacart, Target or Walmart, after you have read and accepted a consent
> screen that lists every field it records and every request it makes. Those records are
> pooled with other panelists' under a random ID that changes weekly, and the extension's
> popup shows you where the price you were shown sits among the prices other panelists were
> shown for the same product, store and delivery option. When the panel has not seen enough of
> a product to be sure, it says UNRESOLVED rather than guess.
>
> It also shows whether being signed in is changing your price right now, by asking the
> retailer for the public page of the product you are viewing, the way a visitor who is not
> signed in would see it: without your cookies or sign-in, at most once an hour per product.
>
> It never reads your retailer password, sign-in session, cookies or payment details; never
> records your name, email, full ZIP, IP address or browser fingerprint; never signs in,
> clicks, searches or navigates for you; and never records anything on any other site. You can
> export and delete everything from the options page at any time. Records on our server are
> deleted after 90 days regardless.
>
> Open source: https://github.com/Skeaks/PennyPincher

**Category:** Shopping. **Language:** English (US).

**Privacy policy URL:**
`https://github.com/Skeaks/PennyPincher/blob/main/docs/compliance/privacy-policy.md` (the
store requires one; the draft is fine for an unlisted listing, and the URL survives review
because it is the same document the extension links).

**Homepage:** the Pages site (`apps/web`) once deployed.

**Screenshots (1280x800, at least one):** the consent page, the popup showing a `RESOLVED`
ladder, the popup showing `UNRESOLVED`, the options page. Take them from the built extension
on a fixture page, not a live retailer page with a real account visible.

## 3. Privacy practices tab

The store's questionnaire, answered from the code:

| Question | Answer |
|---|---|
| Single purpose | Records the prices the user was shown on three retailers, with consent, for a price-transparency panel |
| Collects "personally identifiable information" | No. (No name, email, address, or account data. The rotating UUID is not linked to a person.) |
| "Location" | Yes, coarse: the first three digits of the ZIP the retailer displays. Not device location |
| "Web history" | Yes, limited: the addresses of product, search and aisle pages on the three retailers, and nothing off them |
| "User activity" | No clicks, keystrokes, or mouse tracking. Only page content |
| "Website content" | Yes: product name, price, store, delivery option on those pages |
| Authentication information | No |
| Personal communications, financial and payment information, health information | No |
| Data use certifications | Not sold; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending |
| Remote code | No |

## 4. Permission justifications

One paragraph per permission, in the form the review asks for.

**Host permission `*://*.instacart.com/*`.** The extension's content script runs on
Instacart pages to read the price, product name, store and delivery option the page already
shows the user, on product pages and on the tiles of search and aisle pages. The same host
permission lets the background worker request the public product page once an hour per
product, without cookies, to compare the signed-in and anonymous price. No other site is
touched.

**Host permission `*://*.target.com/*`.** Same as above, for Target's product pages and
search and category listings.

**Host permission `*://*.walmart.com/*`.** Same as above, for Walmart's product pages and
search and browse listings.

**`storage`.** Holds the consent record (version and time), the locally recorded observations
until they are uploaded (at most 5,000; oldest dropped), the rotating panelist ID and its
retired predecessors, the lever probe's hourly rate table and results, the daily page-reader
counts, and the sync bookkeeping. Everything is exportable and deletable from the options
page.

**`alarms`.** Three timers: the 15-minute upload, the hourly pruning of the lever probe's
rate table, and the daily page-reader counts upload. A service worker has no other way to run
on a schedule.

**Not requested, and why the review should not expect them:** no `cookies` (the extension must
never read a retailer session), no `tabs` or `scripting` (it never navigates or injects
beyond its declared content scripts), no `webRequest` or `declarativeNetRequest` (it never
observes or rewrites the user's traffic). `apps/extension/test/posture.test.ts` fails if any
of these appears in the manifest.

## 5. Submitting an unlisted listing

1. Developer Dashboard (the Skeaks Google account; the one-time developer fee is already paid or
   is paid now) > New item > upload the zip.
2. Store listing: paste section 2; upload the screenshots and a 128x128 icon.
3. Privacy: paste section 3 and section 4; enter the privacy policy URL.
4. Distribution: **Visibility: Unlisted.** Regions: United States only.
5. Submit for review. Expect hours to a few days. Review questions arrive by email; the
   answers are in section 4.
6. Once published, copy the store link. It is the link that goes in the invitation email; the
   listing is not searchable.

## 6. Updating

Bump `version` in `apps/extension/package.json`, rebuild the zip, upload it as a new package
on the same item, resubmit. Panelists receive the update automatically, usually within hours.
A change to what is collected or to the requests made bumps `CONSENT_VERSION` too, and the
updated extension turns itself off until the panelist accepts the new text; say so in the
release note on the store and in the email to panelists.

## 7. Before the first submission (Jamie)

- [ ] `apps/extension/.env` has the production API origin and the production `PILOT_TOKEN`.
- [ ] `version` bumped from `0.1.0` to the pilot number.
- [ ] `docs/compliance/privacy-policy.md` brackets filled (contact address, legal entity).
- [ ] Screenshots taken from fixture pages.
- [ ] A 128x128 icon exists (there is none in the repo; WXT ships a placeholder).
