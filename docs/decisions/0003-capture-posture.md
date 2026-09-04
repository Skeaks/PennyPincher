# ADR 0003: Capture posture. Client-side, passive, logged-out probes only

**Status:** accepted, 2026-09-04. Counsel review required before public beta (S16 exit).

## Decision

Three lines that must hold in every session:

1. **Passive capture.** The extension reads prices from DOM the user's browser already rendered
   during the user's own browsing. It never navigates, clicks, searches or paginates on the
   user's behalf on a retailer site.
2. **Logged-out probes.** The lever probe fetches the public product page for the item the user
   is looking at with `credentials: "omit"`, from the extension's background context, at most
   once per product per hour, with a plain user-agent. It never uses the user's session, cookies
   or tokens, and never calls a login or auth endpoint.
3. **Nothing sensitive leaves the browser.** No credentials, cookies, user-agent strings, full
   ZIPs, names, emails. `packages/schema` rejects forbidden keys; `scripts/check-forbidden-api.sh`
   rejects the code that would produce them.

## Why

This is the *hiQ v. LinkedIn* / *Van Buren* / *Meta v. Bright Data* safe side: logged-off access
to public pages, plus consented observation of the user's own screen. Server-side credentialed
login is the posture regulators and courts treat worst, and it is the one the incumbents'
scraping suits target. The constraint is enforced in CI because a doc nobody rereads is not a
control.

## What this rules out

- Automating a logged-in session to "check other buckets". Not possible anyway: assignment is
  hash-stable per account.
- VPN or proxy rotation inside the product. Location variance is measured across the panel
  (zip3 context) and by the logged-out probe, not by faking location. If a future session wants
  a "try a different region" feature, it is a new ADR and a counsel question first.
- Any use of `chrome.cookies`, `document.cookie`, `webRequestBlocking`,
  `declarativeNetRequest`.

## Consent

Capture is off until the user completes an explicit consent screen (S04) that says, in plain
words, what is collected, what is not, and how to delete it. Consent state is stored locally and
re-asked on any change to the collected fields.
