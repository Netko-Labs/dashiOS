/**
 * A short command in the person's words, down to the thing it names: "turn
 * on dark mode" is Dark Mode, "set volume to 30" is the volume, "switch off
 * bluetooth" is Bluetooth. The ranking matches names and keywords, so when
 * the whole words find nothing, the launcher looks again for what is left
 * once the command's verb (and an article) in front and a value at the end
 * ("to 30", "50%", "on") are taken off (rows.ts `found`); and a hand-off
 * defers to what that finds (launcher/lib/agents/handoff-rows.ts). Only for a short
 * command: what is left is three words at most, so a real task ("find me a
 * hotel in SF next week and add it to my calendar") stays a task. Pure;
 * English verbs, folded.
 */

import { fold } from "./fold.ts";

/** Verbs a command to a setting or an action starts with, longest first so "turn on" goes before "turn". */
const LEADS = [
  "please turn on",
  "please turn off",
  "turn on",
  "turn off",
  "turn up",
  "turn down",
  "switch on",
  "switch off",
  "switch to",
  "change to",
  "go to",
  "turn",
  "switch",
  "set",
  "change",
  "enable",
  "disable",
  "toggle",
  "open",
  "show",
  "launch",
  "start",
  "mute",
  "unmute",
].map((lead) => lead.split(" "));

/** Words between the verb and the thing ("the", "my"). */
const ARTICLES = new Set(["the", "my", "a", "an"]);

/** A value at the end: "on", "off", "up", "down", "max", a number, a percent. */
const VALUE = /^(?:on|off|up|down|max|maximum|min|minimum|full|\d+(?:[.,]\d+)?%?|%)$/;
/** Words that join the thing to its value ("to 30", "at 50%"). */
const JOINS = new Set(["to", "at", "by"]);

/** The most words the thing a command names may have. */
export const MOST_CORE_WORDS = 3;

/** The words after a command's verb and article, or null when the words don't start with one. */
function afterLead(query: string): string[] | null {
  let words = fold(query.trim())
    .replace(/[.!]+$/, "")
    .split(/\s+/)
    .filter(Boolean);
  const lead = LEADS.find((each) => each.every((word, at) => words[at] === word));
  if (!lead) return null;
  words = words.slice(lead.length);
  while (words.length > 0 && ARTICLES.has(words[0] as string)) words = words.slice(1);
  return words;
}

/** Whether the words start with a command's verb ("turn on", "set the volume"): a sentence the person is typing. */
export const startsWithCommand = (query: string): boolean => afterLead(query) !== null;

/**
 * The thing a short command names, folded ("dark mode" for "Turn on Dark
 * Mode"), or null when the words aren't a command to something (no verb in
 * front, nothing left, or more than MOST_CORE_WORDS words left).
 */
export function commandCore(query: string): string | null {
  let words = afterLead(query);
  if (!words) return null;
  // The value at the end, and its "to": "volume to 30" is the volume; "brightness 50%" the brightness.
  while (words.length > 1 && VALUE.test(words.at(-1) as string)) {
    words = words.slice(0, -1);
    if (words.length > 1 && JOINS.has(words.at(-1) as string)) words = words.slice(0, -1);
  }
  if (words.length === 0 || words.length > MOST_CORE_WORDS) return null;
  return words.join(" ");
}
