/**
 * Which language some words are in, English or Spanish (gate.ts, land.ts):
 * by their commonest little words and Spanish letters. Enough to tell the
 * correction model what to expect and to keep an English dictionary from
 * judging Spanish; never used to change a word.
 */

const ES = new Set(
  "el la los las un una unos unas de del que y en es se lo le por con para como pero más muy ya sí te mi tu su al esto eso esta este hay fue ser son está están tengo tiene quiero porque cuando donde qué cómo también entonces bueno hola gracias".split(
    " ",
  ),
);
const EN = new Set(
  "the an of and to in is it that this for with as on are was be have has not but or if so we you they i he she my your can will would just what when where how there here do does did".split(
    " ",
  ),
);

const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}']+/gu) ?? [];

/** How Spanish and how English `text` reads: the count of each language's little words (a Spanish letter counts too). */
export function languageScores(text: string): { es: number; en: number } {
  const words = wordsOf(text);
  const es = words.filter((word) => ES.has(word)).length + (text.match(/[ñ¿¡áéíóú]/gi)?.length ?? 0);
  const en = words.filter((word) => EN.has(word)).length;
  return { es, en };
}

/** The languages of what was said, the likeliest first; `fallback` (the session's) when the words do not say. */
export function languagesOf(text: string, before: string, fallback: string | undefined): string[] {
  const said = languageScores(text);
  const around = languageScores(before);
  const es = said.es * 2 + around.es;
  const en = said.en * 2 + around.en;
  const first = fallback?.slice(0, 2).toLowerCase();
  if (es === 0 && en === 0) return first === "es" || first === "en" ? [first] : [];
  // The other language is named only when a fair part of the words are its.
  const [most, least, order] = es > en ? [es, en, ["es", "en"]] : [en, es, ["en", "es"]];
  return least * 3 >= most ? order : order.slice(0, 1);
}
