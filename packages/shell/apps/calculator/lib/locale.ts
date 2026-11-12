/**
 * How the person writes numbers: the decimal mark and the grouping their
 * region uses (System Settings' Language & Region, `region.formats` in
 * `~/.config/dashi/settings.json`, else the process's `LC_NUMERIC`/`LANG`).
 * Pure, apart from `useNumberLocale`, which reads the settings file once and
 * again when it changes (a watch on its folder, no polling).
 *
 * Bun's Intl ignores `LANG`, so the locale is always named explicitly here.
 * Digits are always Latin (0-9): the keypad and the keyboard type those.
 */

import { readFileSync, watch } from "node:fs";
import { basename, dirname } from "node:path";
import { useEffect, useState } from "react";
import { localeFromEnv, toBcp47 } from "../../../src/shared/locale/index.ts";
import { settingsPath } from "../../../src/shared/settings/index.ts";
import { readRegionSettings } from "../../../src/shared/time/index.ts";

export interface NumberLocale {
  /** The BCP 47 tag the separators come from ("de-DE"). */
  tag: string;
  /** "." or "," (or "٫"): what the decimal key types and the display shows. */
  decimal: string;
  /** The thousands separator the locale writes: ",", ".", " " (narrow no-break space), "’". */
  group: string;
}

const FALLBACK_TAG = "en-US";
const formatters = new Map<string, Intl.NumberFormat>();

/** The locale's whole-number formatter (grouped, Latin digits); en-US's when the tag is not one Intl knows. */
function integerFormat(tag: string): Intl.NumberFormat {
  let found = formatters.get(tag);
  if (!found) {
    try {
      found = new Intl.NumberFormat(tag, { numberingSystem: "latn", useGrouping: true, maximumFractionDigits: 0 });
    } catch {
      found = new Intl.NumberFormat(FALLBACK_TAG, { numberingSystem: "latn", useGrouping: true, maximumFractionDigits: 0 });
    }
    formatters.set(tag, found);
  }
  return found;
}

/** The separators of a BCP 47 locale ("de-DE" → decimal ",", group "."). */
export function numberLocale(tag: string): NumberLocale {
  let parts: Intl.NumberFormatPart[];
  try {
    parts = new Intl.NumberFormat(tag, { numberingSystem: "latn", useGrouping: true }).formatToParts(1234567.5);
  } catch {
    return numberLocale(FALLBACK_TAG);
  }
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const group = parts.find((part) => part.type === "group")?.value ?? (decimal === "," ? "." : ",");
  return { tag: integerFormat(tag).resolvedOptions().locale, decimal, group };
}

export const EN_US: NumberLocale = numberLocale(FALLBACK_TAG);

/** A run of digits ("1234567") grouped the locale's way: "1,234,567", "1.234.567", "12,34,567" (en-IN). */
export function groupDigits(digits: string, locale: NumberLocale): string {
  if (!/^\d+$/.test(digits)) return digits;
  return integerFormat(locale.tag).format(BigInt(digits));
}

/** Spaces and apostrophes group digits in some locales and are never a decimal mark in any. */
const NEUTRAL_GROUPS = ["\u00a0", "\u202f", "\u2009", "'", "’"];

/** The marks a number may use in `locale`: its decimal marks, and the marks that group digits. */
export function numberMarks(locale: NumberLocale): { decimals: ReadonlySet<string>; groups: ReadonlySet<string> } {
  const groups = new Set([locale.group, ...NEUTRAL_GROUPS]);
  groups.delete(locale.decimal);
  // "." and "," both mean the decimal point unless one of them is the locale's grouping.
  const decimals = new Set([locale.decimal, ...[".", ","].filter((mark) => !groups.has(mark))]);
  return { decimals, groups };
}

/** The locale named by the person's settings or the environment, as a BCP 47 tag; en-US when none is. */
export function numberLocaleTag(formats: string | undefined, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const named = formats ?? localeFromEnv(env, "LC_NUMERIC");
  return (named ? toBcp47(named) : null) ?? FALLBACK_TAG;
}

/** The number locale in a settings file (`region.formats`), else the environment's. */
export function readNumberLocale(path: string = settingsPath(), env: Readonly<Record<string, string | undefined>> = process.env): NumberLocale {
  let formats: string | undefined;
  try {
    formats = readRegionSettings(JSON.parse(readFileSync(path, "utf8"))).region.formats;
  } catch {
    formats = undefined;
  }
  return numberLocale(numberLocaleTag(formats, env));
}

/** The person's number locale, kept current when System Settings changes the region. */
export function useNumberLocale(path: string = settingsPath()): NumberLocale {
  const [locale, setLocale] = useState(() => readNumberLocale(path));
  useEffect(() => {
    const look = (): void => {
      const next = readNumberLocale(path);
      setLocale((old) => (old.tag === next.tag && old.decimal === next.decimal && old.group === next.group ? old : next));
    };
    // The folder, not the file: settings.json is replaced on every save (written beside it, then renamed).
    let watcher: ReturnType<typeof watch> | null = null;
    try {
      watcher = watch(dirname(path), (_event, name) => {
        if (name === null || name === basename(path)) look();
      });
    } catch {
      // No settings folder yet: the locale stays what it was at launch.
    }
    return () => watcher?.close();
  }, [path]);
  return locale;
}
