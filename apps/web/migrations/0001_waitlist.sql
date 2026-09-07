-- 0001: the pilot waitlist (S15). The one table anywhere in PennyPincher that holds an email
-- address, in its own D1 database, bound only to the landing page's Pages Function.
--
-- email is the primary key: INSERT OR IGNORE makes a second submission a no-op, so the form
-- never reveals whether an address is already on the list. joined_at is when the row was
-- written, so invitations go out in order and the list can be purged on a date. Nothing else
-- is stored: no name, no IP, no user-agent, no referrer.
CREATE TABLE IF NOT EXISTS waitlist (
  email     TEXT PRIMARY KEY,
  joined_at TEXT NOT NULL
);
