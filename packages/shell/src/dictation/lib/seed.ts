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
  { term: "T3 Code", heard: ["d tree code", "t three code", "tea three code", "t tree code", "d three code"] },
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

/** What the computer says the person's names are, as they are now: the installed apps, their project folders, the sites they allowed. */
export interface KnownNames {
  apps: readonly string[];
  /** The folders at the top of their home, and at the top of a folder that holds projects (~/Developer). */
  folders: readonly string[];
  /** Sites the person allowed agents to use ("bodytech.com.co"). */
  sites: readonly string[];
}

const MOST_FOLDERS = 80;
const MOST_SITES = 60;
/** The end of a host that is no name: "com", "co", "org", a country. */
const SUFFIX = /^(?:com|net|org|edu|gov|io|ai|app|dev|co|[a-z]{2})$/;

/** A folder that is a name: one word of three letters or more, maybe with digits after ("dashiOS", "mirin", "T3"); never "v09", "smoke-0.9". */
const folderName = (name: string, words: Words | undefined): boolean =>
  /^\p{L}[\p{L}\p{N}]{1,29}$/u.test(name) && (name.match(/\p{L}/gu)?.length ?? 0) >= 3 && isName(name, words);

/** "bodytech.com.co" is "Bodytech", heard as "body tech" when it is two words the dictionary has. */
function siteTerm(site: string, words: Words | undefined): Term | null {
  const labels = site.toLowerCase().split(".");
  while (labels.length > 1 && SUFFIX.test(labels.at(-1) ?? "")) labels.pop();
  const label = labels.at(-1) ?? "";
  if (!/^[a-z][a-z0-9]{2,29}$/.test(label) || /^\d/.test(site) || site === "localhost") return null;
  const heard: string[] = [];
  for (let at = 3; at <= label.length - 3; at++) {
    const [one, two] = [label.slice(0, at), label.slice(at)];
    if (words?.loaded && words.common(one) && words.common(two)) heard.push(`${one} ${two}`);
  }
  return { term: label[0]?.toUpperCase() + label.slice(1), heard: heard.slice(0, 2) };
}

/**
 * The names Dashi knows from the computer (D198), beside the person's vocabulary file and never written into it:
 * dictation writes them and the assistant hears them, and they follow what is installed and allowed.
 */
export function knownTerms(names: KnownNames, words?: Words): Term[] {
  // Dashi's own words first: a vocabulary file written before one was added ("T3 Code") still hears it.
  const terms: Term[] = [...OWN_TERMS];
  const have = new Set(OWN_TERMS.map((each) => each.term.toLowerCase()));
  const add = (term: Term | null): void => {
    if (!term || have.has(term.term.toLowerCase())) return;
    have.add(term.term.toLowerCase());
    terms.push(term);
  };
  for (const app of names.apps.filter((name) => isName(name, words)).slice(0, MOST_APPS)) add({ term: app, heard: [] });
  for (const folder of names.folders.filter((name) => folderName(name, words)).slice(0, MOST_FOLDERS)) add({ term: folder, heard: [] });
  for (const site of names.sites.slice(0, MOST_SITES)) add(siteTerm(site, words));
  return terms;
}
