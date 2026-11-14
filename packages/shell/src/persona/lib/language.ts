/** The language a character's text is given in: Spanish where the person said so, or where the region's formats (else `$LANG`) are Spanish; English otherwise. */

export const LANGUAGES = ["auto", "en", "es"] as const;
export type PersonaLanguage = (typeof LANGUAGES)[number];
export const isPersonaLanguage = (value: unknown): value is PersonaLanguage => LANGUAGES.some((each) => each === value);

export function promptLanguage(language: PersonaLanguage, formats: string | undefined, lang: string | undefined): "en" | "es" {
  if (language !== "auto") return language;
  return (formats ?? lang ?? "").toLowerCase().startsWith("es") ? "es" : "en";
}
