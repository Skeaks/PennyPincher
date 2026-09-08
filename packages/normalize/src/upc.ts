/**
 * UPC / EAN / GTIN normalisation.
 *
 * Retailers print the same code in different widths: a 12-digit UPC-A on a US label is the
 * 13-digit EAN with a leading zero and the 14-digit GTIN with two. GS1 defines them all as
 * right-aligned in 14 digits, so GTIN-14 is the canonical form. The last digit is a mod-10
 * check digit; a code that fails it is a misread, not a product, and is rejected.
 *
 * UPC-E (8 digits starting with 0) is a zero-suppressed UPC-A; it is expanded before padding.
 * EAN-8 (8 digits, other leading digits) is its own numbering and is padded like the rest.
 */

/** Accepted widths, per GS1: UPC-E/EAN-8, UPC-A, EAN-13, GTIN-14. */
const WIDTHS = new Set([8, 12, 13, 14]);

/** The GS1 mod-10 check digit for `digits` (which must not include one). */
export function gs1CheckDigit(digits: string): number {
  let sum = 0;
  // Weights alternate 3, 1 starting from the right-most digit (the one next to the check).
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(digits.length - 1 - i) - 48;
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

/** Whether a full code (check digit included) passes the mod-10 check. */
export function hasValidCheckDigit(code: string): boolean {
  const last = code.charCodeAt(code.length - 1) - 48;
  return gs1CheckDigit(code.slice(0, -1)) === last;
}

/**
 * Expand a UPC-E (8 digits, number system 0) to its 12-digit UPC-A. The check digit carries
 * over unchanged; the caller re-checks it on the expanded form. Returns undefined for a code
 * that is not a UPC-E.
 */
export function expandUpcE(code: string): string | undefined {
  if (code.length !== 8 || code[0] !== "0") return undefined;
  const d = code.split("");
  const d1 = d[1] ?? "";
  const d2 = d[2] ?? "";
  const d3 = d[3] ?? "";
  const d4 = d[4] ?? "";
  const d5 = d[5] ?? "";
  const d6 = d[6] ?? "";
  const check = d[7] ?? "";
  let body: string;
  switch (d6) {
    case "0":
    case "1":
    case "2":
      body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
      break;
    case "3":
      body = `${d1}${d2}${d3}00000${d4}${d5}`;
      break;
    case "4":
      body = `${d1}${d2}${d3}${d4}00000${d5}`;
      break;
    default:
      body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  }
  return `0${body}${check}`;
}

/**
 * Normalise a UPC / EAN / GTIN as a page shows it to GTIN-14. Digits only after stripping
 * spaces and hyphens; 8, 12, 13 or 14 wide; the check digit must hold. Anything else is
 * undefined: a wrong code is worse than no code, because it merges two products.
 */
export function normalizeUpc(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits) || !WIDTHS.has(digits.length)) return undefined;
  if (/^0+$/.test(digits)) return undefined;
  const full = expandUpcE(digits) ?? digits;
  if (!hasValidCheckDigit(full)) return undefined;
  return full.padStart(14, "0");
}
