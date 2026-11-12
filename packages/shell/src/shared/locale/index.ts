export type { LocaleEntry } from "./locale.ts";
export {
  canonicalLocale,
  formatsForRegion,
  isFormatsLocale,
  isLocaleName,
  isRegionOf,
  languageOf,
  localeEntries,
  localeFromEnv,
  parseInstalledLocales,
  regionRows,
  searchLocales,
  toBcp47,
  withLanguage,
} from "./locale.ts";
export type { Localized } from "./messages.ts";
export { languagesOf, localizedDesktop, messageLocales } from "./messages.ts";
