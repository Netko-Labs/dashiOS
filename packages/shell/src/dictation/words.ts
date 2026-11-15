/**
 * Which words are words (lib/gate.ts, lib/rules-terms.ts, lib/fit.ts): the system's
 * spelling dictionaries (hunspell's `.dic` files, a separate package Dashi
 * only reads), English and Spanish, read once when dictation first needs
 * them. Only the stems are read, so an English word is also known by its
 * common endings. Where no dictionary is installed nothing is known, and
 * the rules that need one stand down.
 */

import { existsSync, readFileSync } from "node:fs";

export interface Words {
  /** Whether any dictionary was found: without one, `known` and `common` are always false. */
  readonly loaded: boolean;
  /** A word of the language, a name included. */
  known(word: string): boolean;
  /** An ordinary word: the dictionary lists it in lower case. */
  common(word: string): boolean;
}

export const NO_WORDS: Words = { loaded: false, known: () => false, common: () => false };

const ENDINGS: readonly (readonly [RegExp, string])[] = [
  [/n['’]t$/, ""],
  [/['’](s|re|ve|ll|d|m)$/, ""],
  [/ies$/, "y"],
  [/ied$/, "y"],
  [/es$/, ""],
  [/s$/, ""],
  [/ed$/, ""],
  [/ed$/, "e"],
  [/ing$/, ""],
  [/ing$/, "e"],
  [/ly$/, ""],
  [/er$/, ""],
  [/est$/, ""],
  [/(.)\1ed$/, "$1"],
  [/(.)\1ing$/, "$1"],
];

/** The words of `lists` (one stem a line, hunspell's flags after a slash), as a dictionary. */
export function wordsFrom(lists: readonly string[]): Words {
  const lower = new Set<string>();
  const any = new Set<string>();
  for (const text of lists) {
    for (const line of text.split("\n")) {
      const stem = line.split("/")[0]?.split("\t")[0]?.trim() ?? "";
      if (stem === "" || /^\d+$/.test(stem)) continue;
      const folded = stem.toLowerCase();
      any.add(folded);
      if (stem === folded) lower.add(folded);
    }
  }
  const within = (set: ReadonlySet<string>, word: string): boolean => {
    const folded = word.toLowerCase().replace(/’/g, "'");
    if (set.has(folded)) return true;
    return ENDINGS.some(([ending, stem]) => ending.test(folded) && set.has(folded.replace(ending, stem)));
  };
  return { loaded: any.size > 0, known: (word) => within(any, word), common: (word) => within(lower, word) };
}

const FILES = ["en_US", "en_GB", "es_ES", "es_MX", "es"].map((name) => `/usr/share/hunspell/${name}.dic`);

function read(file: string): string | null {
  try {
    if (!existsSync(file)) return null;
    // hunspell's Spanish is Latin-1 on some systems: read as it says it is.
    const bytes = readFileSync(file);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return text.includes("�") ? new TextDecoder("latin1").decode(bytes) : text;
  } catch {
    return null;
  }
}

let system: Words | null = null;

/** The system's dictionaries, read at the first ask. */
export function systemWords(): Words {
  if (system) return system;
  const lazy: Words = {
    get loaded(): boolean {
      return real().loaded;
    },
    known: (word) => real().known(word),
    common: (word) => real().common(word),
  };
  let loaded: Words | null = null;
  const real = (): Words => {
    loaded ??= wordsFrom(FILES.map(read).filter((text): text is string => text !== null));
    return loaded;
  };
  system = lazy;
  return lazy;
}
