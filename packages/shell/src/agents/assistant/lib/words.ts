/** Words the assistant acts on by rule, before any model hears them: the ones that end the conversation, and "undo that". */

const flat = (heard: string): string =>
  heard
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}' ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Said before or after the words themselves, and still the same wish. */
const POLITE =
  /^(?:ok(?:ay)?|thanks|thank you|gracias|vale|bueno|dashi|hey dashi|please|por favor|so|and|y)\s+|\s+(?:thanks|thank you|gracias|please|por favor|dashi|for now|por ahora)$/g;

const stripped = (heard: string): string => {
  let text = flat(heard);
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(POLITE, "").trim();
  }
  return text;
};

const ENDS = new Set([
  "that's all",
  "thats all",
  "that is all",
  "that'll be all",
  "that will be all",
  "new topic",
  "forget that",
  "forget it",
  "eso es todo",
  "es todo",
  "nada mas",
  "tema nuevo",
  "nuevo tema",
  "otro tema",
  "olvida eso",
  "olvidalo",
]);

/**
 * Whether what was said ends the conversation: "that's all", "new topic",
 * "forget that", and their Spanish, as the whole of it (a "thanks" or
 * "OK" around them is still the same). Anything longer goes to the model.
 */
export const endsTalk = (heard: string): boolean => ENDS.has(stripped(heard)) || ENDS.has(flat(heard));

const UNDOES = new Set(["undo that", "undo", "undo it", "put it back", "put that back", "deshaz eso", "deshazlo", "deshacer", "deshace eso", "revierte eso"]);

const REMEMBER =
  /^(?:remember(?: that|:)? (?=(?:that |i |i'|my |me |we |our |to call me ))|recuerda(?: que)? (?=(?:que |yo |mi |mis |me |nos |soy |tengo )))(.+)$/i;

/**
 * What the person asks Dashi to remember about them, in their own words:
 * "remember that I go to Bodytech on Mondays", "recuerda que me llamo Pe".
 * Null for anything else ("remember to buy milk", "can you remember what I
 * said?"): those are the model's to answer.
 */
export function asksRemember(heard: string): string | null {
  const said = heard
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:ok(?:ay)?|please|hey dashi|dashi|por favor)[, ]+/i, "");
  const found = REMEMBER.exec(said);
  const fact =
    found?.[1]
      ?.replace(/^that /i, "")
      .replace(/^que /i, "")
      .replace(/[.!]+$/, "")
      .trim() ?? "";
  return fact.split(" ").length >= 2 ? fact.charAt(0).toUpperCase() + fact.slice(1) : null;
}

/** Whether what was said asks to take the last change back: "undo that" as the whole of it. */
export const asksUndo = (heard: string): boolean => UNDOES.has(stripped(heard));
