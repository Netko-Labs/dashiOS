/**
 * Numbers as the person writes and reads them. Typing, the Region's decimal
 * separator is always a decimal point, and the other one is too unless it
 * groups thousands ("2,5" is two and a half anywhere; "1,000" is a thousand
 * in English, "1.000" in German). Shown, numbers follow the Region (`de-DE`
 * writes 1.234,5); copied, they keep its decimal separator but no grouping, so
 * they paste as one number.
 */

export interface NumberStyle {
  decimal: "." | ",";
}

const styles = new Map<string, NumberStyle>();

/** The decimal separator `locale` writes; "." for a locale Intl doesn't know. */
export function numberStyle(locale: string): NumberStyle {
  const known = styles.get(locale);
  if (known) return known;
  let decimal: NumberStyle["decimal"] = ".";
  try {
    const part = new Intl.NumberFormat(locale).formatToParts(1.5).find((each) => each.type === "decimal");
    if (part?.value === ",") decimal = ",";
  } catch {
    // An unknown locale writes as en-US does.
  }
  const style = { decimal };
  styles.set(locale, style);
  return style;
}

/** One written number, separators and all: `1,234.5`, `2,5`, `1.000.000`. */
const WRITTEN = /\d+(?:[.,]\d+)*/g;

/** `written` with a plain `.` for its decimal point and no grouping; null when it can't be one number ("1,2,3"). */
export function canonicalNumber(written: string, style: NumberStyle): string | null {
  const separators = [...written].filter((char) => char === "." || char === ",");
  if (separators.length === 0) return written;
  const groups = written.split(/[.,]/);
  const kinds = new Set(separators);
  if (kinds.size === 2) {
    // Both: the last one is the decimal point, and it comes once; the other groups thousands.
    const decimal = separators.at(-1) as string;
    if (separators.filter((char) => char === decimal).length !== 1) return null;
    const [whole, fraction] = [written.slice(0, written.lastIndexOf(decimal)), written.slice(written.lastIndexOf(decimal) + 1)];
    return isGrouped(whole.split(/[.,]/)) ? `${whole.replace(/[.,]/g, "")}.${fraction}` : null;
  }
  const only = separators[0] as string;
  if (separators.length > 1) return isGrouped(groups) ? groups.join("") : null;
  // One separator: the Region's decimal point is one; the other is one unless three digits follow it.
  if (only === style.decimal || groups[1]?.length !== 3) return groups.join(".");
  return groups.join("");
}

/** `1`, `000`, `000`: a first group of one to three digits, then groups of three. */
function isGrouped(groups: readonly string[]): boolean {
  const [first, ...rest] = groups;
  return first !== undefined && first.length >= 1 && first.length <= 3 && rest.every((group) => group.length === 3);
}

/** `text` with every number in it canonical; null when one of them can't be read. */
export function canonicalNumbers(text: string, style: NumberStyle): string | null {
  let failed = false;
  const out = text.replace(WRITTEN, (written) => {
    const canonical = canonicalNumber(written, style);
    if (canonical === null) failed = true;
    return canonical ?? written;
  });
  return failed ? null : out;
}

const formats = new Map<string, Intl.NumberFormat>();

function format(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = formats.get(key);
  if (!found) {
    try {
      found = new Intl.NumberFormat(locale, options);
    } catch {
      found = new Intl.NumberFormat("en-US", options);
    }
    formats.set(key, found);
  }
  return found;
}

/** How precise a shown number is: a sum to 8 places; a measure to 2, or 3 significant digits under 1. */
export type Precision = "exact" | "measure";

function digits(value: number, precision: Precision): Intl.NumberFormatOptions {
  if (precision === "exact") return { maximumFractionDigits: 8 };
  const size = Math.abs(value);
  return size !== 0 && size < 1 ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: 2 };
}

/** `value` as the Region writes it, grouped (`1,234.57`, `1.234,57`). */
export function showNumber(value: number, locale: string, precision: Precision = "exact"): string {
  return format(locale, digits(value, precision)).format(value);
}

/** `value` for the clipboard: the Region's decimal point, no grouping (`1234.57`, `1234,57`). */
export function copyNumber(value: number, locale: string, precision: Precision = "exact"): string {
  return format(locale, { ...digits(value, precision), useGrouping: false }).format(value);
}

/** Money as the Region writes it (`€89.09`, `89,09 €`). */
export function showMoney(value: number, currency: string, locale: string): string {
  return format(locale, { style: "currency", currency }).format(value);
}

/** Money for the clipboard: the amount alone, to the currency's own places. */
export function copyMoney(value: number, currency: string, locale: string): string {
  const places = format("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return format(locale, { minimumFractionDigits: places, maximumFractionDigits: places, useGrouping: false }).format(value);
}
