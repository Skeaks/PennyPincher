/**
 * The pilot waitlist (S15), as pure functions: read the form, decide what to store, decide
 * where to send the browser next. The Pages Function in `functions/api/waitlist.ts` is a thin
 * wrapper that supplies the D1-backed store and turns the outcome into a 303 redirect.
 *
 * Privacy posture: the email address is the only thing read from the form, and the only
 * thing stored, together with the time it was stored. The honeypot field is checked and
 * discarded. Nothing about the request (IP, user-agent, referrer) is read or logged.
 */

/** RFC 5321's practical ceiling for a whole address. */
export const EMAIL_MAX_LENGTH = 254;

/** The form field names the landing page uses. `HONEYPOT` is hidden and must stay empty. */
export const FIELDS = { email: "email", honeypot: "website" } as const;

export type Submission =
  | { ok: true; email: string }
  | { ok: false; reason: "missing" | "invalid" | "honeypot" };

/** What `formData.get` gives back, so a test can hand in a Map. */
export interface FormFields {
  get(name: string): unknown;
}

export interface WaitlistStore {
  /** Idempotent: a second add of the same address is `"exists"`, never an error. */
  add(email: string, joinedAt: string): Promise<"added" | "exists">;
}

export type JoinOutcome =
  | { stored: "added" | "exists"; location: string }
  | { stored: "nothing"; reason: "missing" | "invalid" | "honeypot"; location: string };

/** Where the browser goes after each outcome. Relative paths under `public/`. */
export const REDIRECTS = {
  joined: "/joined.html",
  invalid: "/?email=invalid#join",
} as const;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Deliberately simple: one `@`, something on each side, a dot in the domain, no whitespace,
 * within the length ceiling. The invitation email is the real check.
 */
export function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

export function parseSubmission(fields: FormFields): Submission {
  const trap = fields.get(FIELDS.honeypot);
  if (typeof trap === "string" && trap.trim().length > 0) return { ok: false, reason: "honeypot" };
  const raw = fields.get(FIELDS.email);
  if (typeof raw !== "string" || raw.trim().length === 0) return { ok: false, reason: "missing" };
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) return { ok: false, reason: "invalid" };
  return { ok: true, email };
}

/**
 * The whole request, minus HTTP. A tripped honeypot stores nothing but is sent to the same
 * page as a real join, so a bot learns nothing from the response.
 */
export async function join(
  store: WaitlistStore,
  fields: FormFields,
  now: Date = new Date(),
): Promise<JoinOutcome> {
  const submission = parseSubmission(fields);
  if (!submission.ok) {
    const location = submission.reason === "honeypot" ? REDIRECTS.joined : REDIRECTS.invalid;
    return { stored: "nothing", reason: submission.reason, location };
  }
  const stored = await store.add(submission.email, now.toISOString());
  return { stored, location: REDIRECTS.joined };
}
