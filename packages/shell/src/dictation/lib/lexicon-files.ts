/**
 * The plain-text files of `~/.config/dashi/dictation/` (lexicon.ts;
 * docs/voice.md, "Vocabulary and profiles"), read and written here so a
 * person can read and edit them:
 *
 *   vocabulary     one term a line, as it is written; after a colon, what
 *                  the recogniser tends to hear instead: `Dashi: dashy, dead dash`
 *   replacements   `cloud code -> Claude Code`
 *   snippets       `my address -> 12 Example Street\nSpringfield`
 *   profiles/<id>  `key: value` lines (types.ts `Profile`), with `word:` and
 *                  `replace:` lines for the profile's own terms
 *
 * A `#` starts a comment. A line that can't be read is skipped, never fatal.
 */

import type { Pair, Profile, Term } from "../types.ts";

const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

const list = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** Each term may be 60 characters, as the products allow; longer is a mistake in the file. */
const MOST = 60;

export function parseVocabulary(text: string): Term[] {
  const terms: Term[] = [];
  for (const line of lines(text)) {
    const colon = line.indexOf(":");
    const term = (colon >= 0 ? line.slice(0, colon) : line).trim();
    if (term === "" || term.length > MOST) continue;
    terms.push({ term, heard: colon >= 0 ? list(line.slice(colon + 1)) : [] });
  }
  return terms;
}

export function parsePairs(text: string, multiline = false): Pair[] {
  const pairs: Pair[] = [];
  for (const line of lines(text)) {
    const arrow = line.indexOf("->");
    if (arrow <= 0) continue;
    const from = line.slice(0, arrow).trim();
    const to = line.slice(arrow + 2).trim();
    if (from === "" || to === "" || from.length > MOST) continue;
    pairs.push({ from, to: multiline ? to.replace(/\\n/g, "\n") : to });
  }
  return pairs;
}

const HEADER = {
  vocabulary: [
    "# Words dictation should write your way: names, products, terms. One a line.",
    "# After a colon, what the recogniser tends to hear instead:  Dashi: dashy, dead dash",
  ],
  replacements: ["# What was heard -> what is typed. Whole words, any capitals; the longest wins.", "# cloud code -> Claude Code"],
  snippets: ["# Say the words on the left, get the text on the right (\\n is a line break).", "# my address -> 12 Example Street\\nSpringfield"],
} as const;

export const vocabularyText = (terms: readonly Term[]): string =>
  `${[...HEADER.vocabulary, "", ...terms.map((each) => (each.heard.length > 0 ? `${each.term}: ${each.heard.join(", ")}` : each.term))].join("\n")}\n`;

export const pairsText = (kind: "replacements" | "snippets", pairs: readonly Pair[]): string =>
  `${[...HEADER[kind], "", ...pairs.map((pair) => `${pair.from} -> ${pair.to.replace(/\n/g, "\\n")}`)].join("\n")}\n`;

const yes = (value: string): boolean => /^(yes|true|on)$/i.test(value);
const word = (on: boolean): string => (on ? "yes" : "no");

/** A profile's file over what the built-in one says (`base`): a key the file leaves out stays the built-in's. */
export function parseProfile(text: string, base: Profile): Profile {
  const profile: Profile = { ...base, words: [], replacements: [] };
  let own = false;
  for (const line of lines(text)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "name" && value !== "") profile.name = value;
    else if (key === "apps") profile.apps = list(value).map((app) => app.toLowerCase());
    else if (key === "sites") profile.sites = list(value).map((site) => site.toLowerCase());
    else if (key === "tone") profile.tone = value;
    else if (key === "polish") profile.polish = yes(value);
    else if (key === "tidy") profile.tidy = yes(value);
    else if (key === "capitals") profile.capitals = yes(value);
    else if (key === "code") profile.code = yes(value);
    else if (key === "greeting") profile.greeting = yes(value);
    else if (key === "final period" && (value === "keep" || value === "drop" || value === "drop-single")) profile.period = value;
    else if (key === "line breaks" && (value === "return" || value === "shift-return")) profile.breaks = value === "return" ? "hard" : "soft";
    else if (key === "lists" && (value === "markdown" || value === "plain")) profile.lists = value;
    else if (key === "word" && value !== "" && value.length <= MOST) {
      own = true;
      profile.words.push(value);
    } else if (key === "replace") {
      own = true;
      profile.replacements.push(...parsePairs(value));
    }
  }
  return own ? profile : { ...profile, words: [...base.words], replacements: [...base.replacements] };
}

export function profileText(profile: Profile, about: string): string {
  return `${[
    `# ${about}`,
    "# Edit freely. Delete this file to get Dashi's own again.",
    "",
    `name: ${profile.name}`,
    `apps: ${profile.apps.join(", ")}`,
    `sites: ${profile.sites.join(", ")}`,
    `tone: ${profile.tone}`,
    "# Ask the correction model for every sentence, not only where the rules think it is needed.",
    `polish: ${word(profile.polish)}`,
    "# no: nothing is changed but spacing.",
    `tidy: ${word(profile.tidy)}`,
    `capitals: ${word(profile.capitals)}`,
    "# keep, drop, or drop-single (no full stop after a single sentence).",
    `final period: ${profile.period}`,
    "# return, or shift-return where Return sends the message.",
    `line breaks: ${profile.breaks === "hard" ? "return" : "shift-return"}`,
    `# markdown ("- item"), or plain lines.`,
    `lists: ${profile.lists}`,
    `# Casing and symbols by voice ("camel case user id", "dash dash help"), identifiers in backticks.`,
    `code: ${word(profile.code)}`,
    `# A line break after "Hi Alex,".`,
    `greeting: ${word(profile.greeting)}`,
    "",
    "# This profile's own words and replacements, one a line:",
    ...profile.words.map((each) => `word: ${each}`),
    ...profile.replacements.map((pair) => `replace: ${pair.from} -> ${pair.to}`),
  ].join("\n")}\n`;
}
