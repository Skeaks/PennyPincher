import type { Money } from "@pennypincher/schema";

/** "$0.22", "$4.58", "$1,234.56", "$5". Whole dollars without cents are accepted. */
const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?![\d.])/;

export interface ParsedMoney {
  money: Money;
  /** The money token exactly as rendered, e.g. "$0.22". */
  priceText: string;
}

/**
 * First US dollar amount in `text`, as integer minor units. Never floats: cents are assembled
 * from the two digit groups. Returns undefined when there is no dollar amount.
 */
export function parseMoney(text: string): ParsedMoney | undefined {
  const m = MONEY.exec(text);
  if (!m) return undefined;
  const dollars = Number.parseInt((m[1] ?? "0").replace(/,/g, ""), 10);
  const cents = m[2] === undefined ? 0 : Number.parseInt(m[2], 10);
  if (!Number.isSafeInteger(dollars) || !Number.isSafeInteger(cents)) return undefined;
  return {
    money: { amountMinor: dollars * 100 + cents, currency: "USD" },
    priceText: m[0].replace(/\s+/g, ""),
  };
}
