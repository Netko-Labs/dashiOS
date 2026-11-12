/**
 * The person's language for the launcher's words: which locales to read a
 * desktop entry's `Name[xx]`, `GenericName[xx]` and `Keywords[xx]` for, in
 * the order the Desktop Entry Specification gives (de_DE@euro, de_DE,
 * de@euro, de), after `LANGUAGE`'s list. The English name always still
 * matches: the ranking gets both.
 */

/** A locale's lookup keys, best first: `de_DE.UTF-8@euro` gives de_DE@euro, de_DE, de@euro, de. */
export function localeKeys(locale: string): string[] {
  const match = /^([a-z]{2,3})(?:_([A-Z]{2}))?(?:\.[A-Za-z0-9-]+)?(?:@([A-Za-z0-9]+))?$/.exec(locale.trim());
  if (!match) return [];
  const [, language, country, modifier] = match;
  if (language === undefined) return [];
  const keys: string[] = [];
  if (country && modifier) keys.push(`${language}_${country}@${modifier}`);
  if (country) keys.push(`${language}_${country}`);
  if (modifier) keys.push(`${language}@${modifier}`);
  keys.push(language);
  return keys;
}

/**
 * The locale keys to look for, best first: `LANGUAGE`'s list (as gettext reads
 * it, only when a real locale is set), then `LC_ALL`, `LC_MESSAGES` and
 * `LANG`. Empty for C, POSIX or nothing set: the default names are the ones.
 */
export function messageLocales(env: Readonly<Record<string, string | undefined>> = process.env): string[] {
  const main = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find((value) => value !== undefined && value !== "");
  if (!main || main === "C" || main === "POSIX" || main.startsWith("C.")) return [];
  const listed = (env.LANGUAGE ?? "").split(":").filter(Boolean);
  return [...new Set([...listed, main].flatMap(localeKeys))];
}

/** The languages among `locales` (de for de_DE), for Dashi's own words (words.ts). */
export function languagesOf(locales: readonly string[]): string[] {
  return [...new Set(locales.map((locale) => locale.split(/[_@]/)[0] as string))];
}

export interface Localized {
  name?: string;
  genericName?: string;
  keywords: string[];
}

const LOCALIZED_KEY = /^(Name|GenericName|Keywords)\[([^\]]+)\]$/;

/** A desktop entry value with its escapes read (\s, \n, \t, \r, \\); an escaped `;` is left for splitList. */
function unescape(value: string): string {
  return value.replace(/\\([sntr\\])/g, (_, char: string) => ({ s: " ", n: " ", t: " ", r: "", "\\": "\\" })[char] ?? char);
}

/** A list value split on `;`, keeping an escaped `\;` inside its item. */
function splitList(value: string): string[] {
  return value
    .split(/(?<!\\);/)
    .map((item) => item.replace(/\\;/g, ";").trim())
    .filter(Boolean);
}

/**
 * The localized keys of a desktop file's `[Desktop Entry]` group for
 * `locales` (messageLocales): for each key, the value of the best locale it
 * has. Keys with no localized value are left out.
 */
export function localizedDesktop(text: string, locales: readonly string[] = messageLocales()): Localized {
  const found = new Map<string, Map<string, string>>();
  if (locales.length > 0) {
    let inEntry = false;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line.startsWith("[")) {
        inEntry = line === "[Desktop Entry]";
        continue;
      }
      if (!inEntry || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = LOCALIZED_KEY.exec(line.slice(0, eq).trim());
      if (!key) continue;
      const [, field, locale] = key;
      if (field === undefined || locale === undefined) continue;
      const values = found.get(field) ?? new Map<string, string>();
      if (!values.has(locale)) values.set(locale, unescape(line.slice(eq + 1).trim()));
      found.set(field, values);
    }
  }
  const best = (field: string): string | undefined => {
    const values = found.get(field);
    if (!values) return undefined;
    for (const locale of locales) {
      const value = values.get(locale);
      if (value) return value;
    }
    return undefined;
  };
  const name = best("Name");
  const genericName = best("GenericName");
  const keywords = best("Keywords");
  return { ...(name ? { name } : {}), ...(genericName ? { genericName } : {}), keywords: keywords ? splitList(keywords) : [] };
}
