/**
 * Locale names the way glibc and systemd spell them (`de_DE.UTF-8`), read
 * strictly: what `locale -a` prints and what settings.json holds is checked
 * before it is shown, sent to systemd-localed, or turned into an Intl locale.
 * Pure; the installed list comes from `installedLocales` (backend.ts).
 */

export interface LocaleParts {
  language: string;
  territory?: string;
  codeset?: string;
  modifier?: string;
}

const LOCALE = /^([a-z]{2,3})(?:_([A-Z]{2}))?(?:\.([A-Za-z0-9-]{1,16}))?(?:@([a-z]{1,16}))?$/;

/** A locale name split into its parts; null for anything that is not one (including `C` and `POSIX`). */
export function parseLocaleName(name: unknown): LocaleParts | null {
  if (typeof name !== "string" || name.length > 48) return null;
  const match = LOCALE.exec(name);
  if (!match) return null;
  const [, language, territory, codeset, modifier] = match;
  return {
    language: language as string,
    ...(territory ? { territory } : {}),
    ...(codeset ? { codeset } : {}),
    ...(modifier ? { modifier } : {}),
  };
}

export const isLocaleName = (value: unknown): value is string => parseLocaleName(value) !== null;

/** Whether a codeset is UTF-8 in any of glibc's spellings (`utf8`, `UTF-8`). */
const isUtf8 = (codeset: string | undefined): boolean => codeset !== undefined && codeset.toLowerCase().replace("-", "") === "utf8";

/** `de_DE.utf8` as systemd and Fedora write it: `de_DE.UTF-8`. Null for a name that is not a UTF-8 locale. */
export function canonicalLocale(name: string): string | null {
  const parts = parseLocaleName(name);
  if (!parts || !isUtf8(parts.codeset)) return null;
  return `${parts.language}${parts.territory ? `_${parts.territory}` : ""}.UTF-8${parts.modifier ? `@${parts.modifier}` : ""}`;
}

/** The BCP 47 tag Intl wants: `de_DE.UTF-8@euro` is `de-DE`; the two script modifiers glibc has are kept. */
export function toBcp47(name: string): string | null {
  const parts = parseLocaleName(name);
  if (!parts) return null;
  const script = parts.modifier === "latin" ? "Latn" : parts.modifier === "cyrillic" ? "Cyrl" : undefined;
  return [parts.language, script, parts.territory].filter(Boolean).join("-");
}

/**
 * The UTF-8 locales in `locale -a` output, as `de_DE.UTF-8`, sorted and
 * without duplicates. Locales that are not UTF-8 (legacy codesets) and the
 * language-only or `C` ones are left out: a desktop is UTF-8, and a person
 * picks "Germany", not "de".
 */
export function parseInstalledLocales(output: string): string[] {
  const found = new Set<string>();
  for (const line of output.split("\n")) {
    const canonical = canonicalLocale(line.trim());
    if (canonical && parseLocaleName(canonical)?.territory) found.add(canonical);
  }
  return [...found].sort();
}

export interface LocaleEntry {
  /** `de_DE.UTF-8`. */
  id: string;
  bcp47: string;
  /** "German". */
  language: string;
  /** "Germany". */
  region: string | null;
  /** "German (Germany)": the language list's row. */
  label: string;
}

type Names = (code: string, type: "language" | "region") => string | undefined;

/** Names from ICU in the language of the person's Dashi (English, the only one the shell speaks). */
function icuNames(display: string): Names {
  // `none`: a name ICU does not know is no name, rather than the code handed back as if it were one.
  const languages = new Intl.DisplayNames([display], { type: "language", languageDisplay: "standard", fallback: "none" });
  const regions = new Intl.DisplayNames([display], { type: "region", fallback: "none" });
  return (code, type) => {
    try {
      return (type === "language" ? languages : regions).of(code);
    } catch {
      return undefined;
    }
  };
}

/** A locale as a list row; null for a name that is not a locale. `names` is ICU's unless a test supplies one. */
export function describeLocale(id: string, names: Names = icuNames("en")): LocaleEntry | null {
  const parts = parseLocaleName(id);
  const bcp47 = toBcp47(id);
  if (!parts || !bcp47) return null;
  const language = names(parts.language, "language") ?? parts.language;
  const region = parts.territory ? (names(parts.territory, "region") ?? parts.territory) : null;
  const label = names(bcp47, "language") ?? (region ? `${language} (${region})` : language);
  return { id, bcp47, language, region, label };
}

/** The installed locales as list rows, by language and then by region. */
export function localeEntries(ids: readonly string[], names?: Names): LocaleEntry[] {
  return ids
    .flatMap((id) => {
      const entry = describeLocale(id, names);
      return entry ? [entry] : [];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

const fold = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Rows whose language, region, or code contain every word of `query` (accents ignored). */
export function searchLocales(entries: readonly LocaleEntry[], query: string): LocaleEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((entry) => {
    const haystack = fold(`${entry.label} ${entry.id}`);
    return words.every((word) => haystack.includes(word));
  });
}

/** Distinct regions among the entries, for the "Region" list: one row per region, keeping the first locale that names it. */
export function regionRows(entries: readonly LocaleEntry[]): LocaleEntry[] {
  const seen = new Map<string, LocaleEntry>();
  for (const entry of entries) if (entry.region && !seen.has(entry.region)) seen.set(entry.region, entry);
  return [...seen.values()].sort((a, b) => (a.region as string).localeCompare(b.region as string));
}

/**
 * The locale a process was started with: `LC_ALL`, then the category asked for, then `LANG`, the way
 * glibc resolves them. Null when none names a real locale (`C`, `POSIX`, unset).
 */
export function localeFromEnv(env: Readonly<Record<string, string | undefined>>, category = "LC_TIME"): string | null {
  for (const key of ["LC_ALL", category, "LANG"]) {
    const value = env[key];
    if (value && canonicalLocale(value)) return canonicalLocale(value);
  }
  return null;
}

/** The `LANG` in systemd-localed's `Locale` property (`["LANG=en_US.UTF-8", "LC_TIME=…"]`). */
export function languageOf(assignments: readonly string[]): string | null {
  const lang = assignments.find((entry) => entry.startsWith("LANG="))?.slice(5);
  return lang ? (canonicalLocale(lang) ?? null) : null;
}

/**
 * The assignments to hand `SetLocale` so that only `LANG` changes: the other variables the system
 * already sets stay. `SetLocale` replaces the whole set.
 */
export function withLanguage(assignments: readonly string[], locale: string): string[] {
  if (!isLocaleName(locale)) throw new TypeError(`bad locale: ${JSON.stringify(locale)}`);
  return [`LANG=${locale}`, ...assignments.filter((entry) => !entry.startsWith("LANG="))];
}

/** What settings.json `region.formats` may hold: a UTF-8 locale in its canonical spelling. */
export const isFormatsLocale = (value: unknown): value is string => typeof value === "string" && canonicalLocale(value) === value;

/**
 * The locale a row of the Region list stands for: the region's locale in the language the person
 * already speaks (Switzerland in German for a German speaker), else the region's first.
 */
export function formatsForRegion(entries: readonly LocaleEntry[], region: string, language: string | null): LocaleEntry | null {
  const inRegion = entries.filter((entry) => entry.region === region);
  const speaks = language ? parseLocaleName(language)?.language : undefined;
  return inRegion.find((entry) => parseLocaleName(entry.id)?.language === speaks) ?? inRegion[0] ?? null;
}

/** Whether a Region row is the one `formats` falls in. */
export const isRegionOf = (entries: readonly LocaleEntry[], region: string, formats: string | null | undefined): boolean =>
  formats != null && entries.some((entry) => entry.region === region && parseLocaleName(entry.id)?.territory === parseLocaleName(formats)?.territory);
