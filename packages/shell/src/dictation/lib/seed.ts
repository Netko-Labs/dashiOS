/**
 * What the vocabulary starts with (lexicon.ts): Dashi's and mirin's own
 * words, the names the owner's dictation got wrong (the corpus: Claude Code,
 * Dashi, Wispr Flow, Helium, Siri), the person's own name, and the names of
 * the installed apps that are not ordinary words.
 */

import type { Term } from "../types.ts";
import type { Words } from "../words.ts";

/** Dashi's own, each with what Parakeet was seen to hear instead. */
export const OWN_TERMS: readonly Term[] = [
  { term: "Dashi", heard: ["dashy", "dashie", "dead dash"] },
  { term: "mirin", heard: ["mirren"] },
  { term: "Helium", heard: [] },
  { term: "Claude", heard: [] },
  { term: "Claude Code", heard: ["cloud code", "clod code"] },
  { term: "Wispr Flow", heard: ["whisper flow", "whisperflow", "wisper flow"] },
  { term: "Siri", heard: [] },
  { term: "Codex", heard: [] },
  { term: "Parakeet", heard: [] },
  { term: "Washi", heard: ["washy"] },
];

const MOST_APPS = 150;

/** An app's name is worth knowing when it is a name: an inner capital, a digit, or a word no dictionary has. */
function isName(name: string, words: Words | undefined): boolean {
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .+'-]{1,39}$/u.test(name)) return false;
  const parts = name.split(/\s+/);
  if (parts.length > 3) return false;
  if (parts.some((part) => /\p{Ll}\p{Lu}|\d/u.test(part))) return true;
  if (!words?.loaded) return parts.length > 1;
  return parts.some((part) => !words.common(part));
}

export function seedTerms(apps: readonly string[], person: string, words?: Words): Term[] {
  const terms: Term[] = [...OWN_TERMS];
  const have = new Set(terms.map((each) => each.term.toLowerCase()));
  const add = (term: string): void => {
    const name = term.trim();
    if (name === "" || have.has(name.toLowerCase())) return;
    have.add(name.toLowerCase());
    terms.push({ term: name, heard: [] });
  };
  for (const part of person.split(/\s+/)) if (/^\p{Lu}[\p{L}'-]+$/u.test(part)) add(part);
  for (const app of apps.filter((name) => isName(name, words)).slice(0, MOST_APPS)) add(app);
  return terms;
}
