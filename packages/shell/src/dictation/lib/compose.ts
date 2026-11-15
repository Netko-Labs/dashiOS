/**
 * From the recogniser's words to the words that land (land.ts; research
 * 3.1, stage 1): the rules, in order, for the profile of the place in
 * front. Names and terms first (rules-terms.ts), then tidying with its own
 * check (tidy.ts), then what the profile adds: snippets, the Developer
 * profile's casing and symbols (rules-code.ts) and its style
 * (rules-style.ts). Verbatim, or tidying turned off, changes nothing but
 * spacing. No model here: this is what lands on a machine without one.
 */

import type { TidyChange } from "../../shared/pill/index.ts";
import type { LexiconView } from "../lexicon.ts";
import type { Pair, Term } from "../types.ts";
import type { Words } from "../words.ts";
import type { Place } from "./profiles.ts";
import { applyCode, backticks } from "./rules-code.ts";
import { applySpoken } from "./rules-spoken.ts";
import { applyStyle } from "./rules-style.ts";
import { applyTerms } from "./rules-terms.ts";
import { tidy } from "./tidy.ts";

export interface Composing {
  place: Place;
  lexicon: LexiconView;
  words: Words;
  /** Settings › Voice, "Tidy what I say". */
  tidy: boolean;
  /** An agent's prompt runs in the terminal in front (not a bare shell). */
  agent: boolean;
  /** Words of the project in front, when something knows them (later: the repository's identifiers); before the global ones. */
  project?: readonly Term[];
}

export interface Composed {
  /** The recogniser's words. */
  heard: string;
  /** What the rules made of them. */
  text: string;
  changes: TidyChange[];
  /** Tidying's check did not hold: its part was skipped. */
  asHeard: boolean;
  /** The rules made a list of it. */
  listed: boolean;
  /** The vocabulary it was made with, the nearest first. */
  terms: readonly Term[];
}

/** The vocabulary for one dictation, the nearest first: the profile's words, the project's, then the person's. */
export function activeTerms({ place, lexicon, project = [] }: Pick<Composing, "place" | "lexicon" | "project">): Term[] {
  const seen = new Set<string>();
  const terms: Term[] = [];
  for (const each of [...place.profile.words.map((term) => ({ term, heard: [] })), ...project, ...lexicon.vocabulary]) {
    const key = each.term.toLowerCase();
    if (seen.has(key)) {
      // The person's own entry may know what it is heard as.
      const at = terms.findIndex((term) => term.term.toLowerCase() === key);
      if (each.heard.length > 0 && terms[at]?.heard.length === 0) terms[at] = each;
      continue;
    }
    seen.add(key);
    terms.push(each);
  }
  return terms;
}

/** The names the vocabulary writes with a capital (a longer one by its first word), in lower case: never lower-cased, never put in backticks. */
export const namesOf = (terms: readonly Term[]): Set<string> =>
  new Set(terms.filter((each) => each.term !== each.term.toLowerCase()).map((each) => each.term.toLowerCase().split(/\s+/)[0] ?? ""));

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A snippet's words, said as whole words in any capitals, become its text. */
export function applySnippets(text: string, snippets: readonly Pair[]): { text: string; fixes: number } {
  let fixes = 0;
  let out = text;
  for (const snippet of [...snippets].sort((a, b) => b.from.length - a.from.length)) {
    const said = new RegExp(`(?<![\\p{L}\\p{N}])${snippet.from.trim().split(/\s+/).map(escape).join("[,]?\\s+")}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(said, () => {
      fixes++;
      return snippet.to;
    });
  }
  return { text: out, fixes };
}

const fixed = (count: number): TidyChange[] => (count > 0 ? [{ kind: "fix", count }] : []);

/** A shell's prompt with no agent in it: words there are a command, not sentences. */
export const isShell = (composing: Pick<Composing, "place" | "agent">): boolean => composing.place.terminal && !composing.agent;

/** The profile's style on words that are already tidied: what the rules end with, and what a model's answer gets again. */
export function restyle(text: string, composing: Composing, terms: readonly Term[]): { text: string; fixes: number } {
  const { profile } = composing.place;
  const shell = isShell(composing);
  const names = namesOf(terms);
  const styled = applyStyle(text, profile, shell, names);
  return profile.code && !shell ? backticks(styled, names) : { text: styled, fixes: 0 };
}

export function compose(heard: string, composing: Composing): Composed {
  const said = heard.trim().replace(/[ \t]+/g, " ");
  const { profile } = composing.place;
  const terms = activeTerms(composing);
  if (!composing.tidy || !profile.tidy || said === "") return { heard: heard.trim(), text: said, changes: [], asHeard: false, listed: false, terms };
  const named = applyTerms(said, { terms, replacements: [...profile.replacements, ...composing.lexicon.replacements] }, composing.words);
  const spoken = applySpoken(named.text);
  const tidied = tidy(spoken.text);
  const snipped = applySnippets(tidied.typed, composing.lexicon.snippets);
  const coded = profile.code ? applyCode(snipped.text, composing.place.terminal) : { text: snipped.text, fixes: 0 };
  const styled = restyle(coded.text, composing, terms);
  const changes = [...tidied.changes, ...fixed(named.fixes + spoken.fixes + snipped.fixes + coded.fixes + styled.fixes)];
  return { heard: heard.trim(), text: styled.text, changes, asHeard: tidied.asHeard, listed: false, terms };
}
