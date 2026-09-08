/**
 * Size parsing. Retailers write the same size a dozen ways ("64 fl oz", "0.5 gal", "Half
 * Gallon", "2lb", "32 oz", "4ct", "Pack of 4", "(4 Pack)"); the product is the same. This
 * module reads every size expression in a piece of text and reduces it to three canonical
 * dimensions: volume in millilitres, weight in grams, count. Two sizes agree when every
 * dimension they both carry agrees within a small tolerance, which absorbs rounding in a
 * retailer's own conversions (1 gal = 128 fl oz = 3785.41 ml; 2 lb = 32 oz = 907.18 g).
 *
 * Count defaults to 1 when absent: "Kauffman Freeze-Dried Banana Slices 1.5 oz" and the same
 * title with "Pack of 3" are different products, and the single is simply not labelled.
 */

export interface Size {
  /** Volume in millilitres. */
  ml?: number;
  /** Net weight in grams. */
  g?: number;
  /** Units per package. */
  ct?: number;
}

export type Dimension = keyof Size;

/** Relative tolerance when comparing a dimension: 2 lb vs 32 oz, 1 gal vs 128 fl oz. */
export const SIZE_TOLERANCE = 0.03;

const ML_PER_FL_OZ = 29.5735;
const ML_PER_GAL = 3785.41;
const ML_PER_QT = 946.353;
const ML_PER_PT = 473.176;
const G_PER_OZ = 28.3495;
const G_PER_LB = 453.592;

interface UnitDef {
  dimension: Dimension;
  factor: number;
}

/**
 * Unit spellings, longest first so "fl oz" wins over "oz" and "fluid ounces" over "ounces".
 * Matched case-insensitively after a number, with optional whitespace between.
 */
const UNITS: ReadonlyArray<readonly [string, UnitDef]> = [
  ["fluid ounces", { dimension: "ml", factor: ML_PER_FL_OZ }],
  ["fluid ounce", { dimension: "ml", factor: ML_PER_FL_OZ }],
  ["fl. oz.", { dimension: "ml", factor: ML_PER_FL_OZ }],
  ["fl. oz", { dimension: "ml", factor: ML_PER_FL_OZ }],
  ["fl oz", { dimension: "ml", factor: ML_PER_FL_OZ }],
  ["fl.oz", { dimension: "ml", factor: ML_PER_FL_OZ }],
  ["floz", { dimension: "ml", factor: ML_PER_FL_OZ }],
  ["gallons", { dimension: "ml", factor: ML_PER_GAL }],
  ["gallon", { dimension: "ml", factor: ML_PER_GAL }],
  ["gal", { dimension: "ml", factor: ML_PER_GAL }],
  ["quarts", { dimension: "ml", factor: ML_PER_QT }],
  ["quart", { dimension: "ml", factor: ML_PER_QT }],
  ["qt", { dimension: "ml", factor: ML_PER_QT }],
  ["pints", { dimension: "ml", factor: ML_PER_PT }],
  ["pint", { dimension: "ml", factor: ML_PER_PT }],
  ["pt", { dimension: "ml", factor: ML_PER_PT }],
  ["milliliters", { dimension: "ml", factor: 1 }],
  ["millilitres", { dimension: "ml", factor: 1 }],
  ["ml", { dimension: "ml", factor: 1 }],
  ["liters", { dimension: "ml", factor: 1000 }],
  ["litres", { dimension: "ml", factor: 1000 }],
  ["liter", { dimension: "ml", factor: 1000 }],
  ["litre", { dimension: "ml", factor: 1000 }],
  ["l", { dimension: "ml", factor: 1000 }],
  ["ounces", { dimension: "g", factor: G_PER_OZ }],
  ["ounce", { dimension: "g", factor: G_PER_OZ }],
  ["oz.", { dimension: "g", factor: G_PER_OZ }],
  ["oz", { dimension: "g", factor: G_PER_OZ }],
  ["pounds", { dimension: "g", factor: G_PER_LB }],
  ["pound", { dimension: "g", factor: G_PER_LB }],
  ["lbs", { dimension: "g", factor: G_PER_LB }],
  ["lb", { dimension: "g", factor: G_PER_LB }],
  ["kilograms", { dimension: "g", factor: 1000 }],
  ["kg", { dimension: "g", factor: 1000 }],
  ["grams", { dimension: "g", factor: 1 }],
  ["gram", { dimension: "g", factor: 1 }],
  ["g", { dimension: "g", factor: 1 }],
  ["count", { dimension: "ct", factor: 1 }],
  ["ct", { dimension: "ct", factor: 1 }],
  ["pk", { dimension: "ct", factor: 1 }],
  ["pack", { dimension: "ct", factor: 1 }],
  ["pcs", { dimension: "ct", factor: 1 }],
  ["pieces", { dimension: "ct", factor: 1 }],
  ["each", { dimension: "ct", factor: 1 }],
  ["ea", { dimension: "ct", factor: 1 }],
];

const UNIT_BY_NAME = new Map(UNITS.map(([name, def]) => [name, def]));

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "16", "1.5", "0,5", "1/2". */
const NUMBER = String.raw`(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+)`;
const UNIT_ALTERNATION = UNITS.map(([name]) => escapeRegex(name)).join("|");

/** "16 oz", "2lb", "64 fl oz", "1.5 Ounce", "4ct", "4-count". Not "2 Ozbag" (unit fused). */
const NUMBER_UNIT = new RegExp(
  String.raw`(?<![\w.])${NUMBER}\s*-?\s*(${UNIT_ALTERNATION})(?![a-z])`,
  "gi",
);

/** "Pack of 4", "Case of 2", "Value Packs of 6", "Set of 3", "Bags of 12". */
const PACK_OF =
  /(?<![a-z])(?:packs?|cases?|sets?|bags?|boxes|bottles|cans|pouches|tubs)\s+of\s+(\d+)(?![\w.])/gi;

/** "(4 Pack)", "4-Pack", "6 per case", "3 Packs". */
const N_PACK = /(?<![\w.])(\d+)\s*-?\s*(?:packs?|per case)(?![a-z])/gi;

/** "Pack 5", "Packs 4" (a trailing count with no "of"). */
const PACK_N = /(?<![a-z])packs?\s+(\d+)(?![\w.])/gi;

/** "Each", "sold by the each": one unit. */
const EACH = /(?<![a-z])(?:sold by the )?(?:each|ea)(?![a-z])/gi;

/** Word forms: "half gallon", "quarter gallon", "half pint". */
const WORD_FRACTIONS: ReadonlyArray<readonly [RegExp, number]> = [
  [/(?<![a-z])half[\s-]*gal(?:lon)?(?![a-z])/gi, ML_PER_GAL / 2],
  [/(?<![a-z])quarter[\s-]*gal(?:lon)?(?![a-z])/gi, ML_PER_GAL / 4],
  [/(?<![a-z])half[\s-]*pint(?![a-z])/gi, ML_PER_PT / 2],
];

function parseNumber(s: string): number {
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s.replace(",", "."));
}

export interface SizeParse {
  size: Size;
  /** The input with every recognised size expression blanked out. */
  rest: string;
}

/**
 * Read every size expression out of `text`. The first value seen for a dimension wins, so
 * "2 oz (56 g)" keeps 2 oz and "4 oz Pack of 4" keeps both the weight and the count. Returns
 * the parsed size and the text with the size expressions removed, for tokenising.
 */
export function parseSize(text: string): SizeParse {
  const size: Size = {};
  let rest = text;
  const take = (dimension: Dimension, value: number): void => {
    if (!Number.isFinite(value) || value <= 0) return;
    if (size[dimension] === undefined) size[dimension] = value;
  };
  const takeCount = (_: string, n: string): string => {
    take("ct", Number(n));
    return " ";
  };

  for (const [re, ml] of WORD_FRACTIONS) {
    rest = rest.replace(re, () => {
      take("ml", ml);
      return " ";
    });
  }
  rest = rest.replace(PACK_OF, takeCount);
  rest = rest.replace(N_PACK, takeCount);
  rest = rest.replace(PACK_N, takeCount);
  rest = rest.replace(NUMBER_UNIT, (_, n: string, unit: string) => {
    const def = UNIT_BY_NAME.get(unit.toLowerCase());
    if (def) take(def.dimension, parseNumber(n) * def.factor);
    return " ";
  });
  rest = rest.replace(EACH, () => {
    take("ct", 1);
    return " ";
  });
  return { size, rest };
}

/** Merge sizes in priority order: an explicit `sizeText` beats what the title implies. */
export function mergeSizes(...sizes: readonly Size[]): Size {
  const out: Size = {};
  for (const s of sizes) {
    for (const k of ["ml", "g", "ct"] as const) {
      const v = s[k];
      if (v !== undefined && out[k] === undefined) out[k] = v;
    }
  }
  return out;
}

export type SizeAgreement = "agree" | "conflict" | "unknown";

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= SIZE_TOLERANCE * Math.max(a, b);
}

/**
 * Compare two sizes. `conflict` when any dimension both carry disagrees, or when one carries
 * a count above one and the other none (an unlabelled single). `agree` when at least one
 * dimension matched and none conflicted. `unknown` when they share no dimension.
 */
export function compareSizes(a: Size, b: Size): SizeAgreement {
  let agreed = 0;
  for (const k of ["ml", "g"] as const) {
    const x = a[k];
    const y = b[k];
    if (x === undefined || y === undefined) continue;
    if (!close(x, y)) return "conflict";
    agreed += 1;
  }
  const ca = a.ct ?? 1;
  const cb = b.ct ?? 1;
  if (!close(ca, cb)) return "conflict";
  if (a.ct !== undefined && b.ct !== undefined) agreed += 1;
  return agreed > 0 ? "agree" : "unknown";
}

/** A stable text form for ids: "3785ml", "907g", "4ct", joined by "+"; "" when empty. */
export function sizeKey(size: Size): string {
  const parts: string[] = [];
  if (size.ml !== undefined) parts.push(`${Math.round(size.ml)}ml`);
  if (size.g !== undefined) parts.push(`${Math.round(size.g)}g`);
  if (size.ct !== undefined) parts.push(`${Math.round(size.ct)}ct`);
  return parts.join("+");
}
