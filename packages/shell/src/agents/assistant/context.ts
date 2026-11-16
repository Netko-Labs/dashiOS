/**
 * What goes with the person's words (decisions.md D149): the moment they
 * were said in. Built when the key goes down, a few hundred characters,
 * after the words in the user turn so the prompt before it stays the same
 * (and cached): the window in front and, in Helium, its page; what is
 * selected; the time; the Desktop that shows; the apps installed and the
 * names the person uses, for a transcript that mishears them; the language
 * they spoke, which the answer is in; and, when a
 * new session starts inside an open conversation, the last exchanges.
 */

import { oneLine } from "../ask/index.ts";
import type { Exchange } from "./conversation.ts";

export interface Moment {
  /** The window in front: its app's name and title; in Helium, its page. */
  window: { app: string; title: string; url: string | null } | null;
  /** The primary selection's text. */
  selection: string | null;
  time: Date;
  /** The session's language ("en_US"). */
  language: string | undefined;
  /** The Desktop that shows (from 1), of how many, and the windows on it. */
  desktop: { index: number; of: number; windows: number } | null;
  /** The apps installed, by name. */
  apps: readonly string[];
  /** Names the person uses (their sites, products, people), as they are written: "What I know about you" adds to these. */
  names: readonly string[];
  /** How much Dashi says (`talkWords`). */
  talk: string;
  /** What the person had Dashi remember ("What I know about you"); "" for nothing. */
  about: string;
}

/** How long a spoken answer is, as the person chose (Settings › Your Dashi). */
export const talkWords = (talk: "less" | "normal" | "more"): string =>
  ({
    less: "Answer in one short plain sentence, or one word.",
    normal: "Answer in one or two short plain sentences.",
    more: "Answer in up to four short plain sentences.",
  })[talk];

/** The languages the voice service tells (`heard`'s `language`), by name. */
const SPOKEN: Readonly<Record<string, string>> = { en: "English", es: "Spanish", fr: "French", hi: "Hindi", it: "Italian", pt: "Portuguese" };

/** "They spoke Spanish: answer in Spanish…", when the words told their language; the prompt's rule holds when they did not. */
export function spokeWords(language: string | undefined): string | null {
  const name = SPOKEN[language?.split(/[-_]/)[0]?.toLowerCase() ?? ""];
  return name ? `They spoke ${name}: answer in ${name}. Keep the names of products, apps and sites as they are written.` : null;
}

/** The most of the app list that goes with an ask. */
const APPS_MAX = 80;
const SELECTION_MAX = 600;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const two = (value: number): string => String(value).padStart(2, "0");

/** "Sunday 15 November 2026, 21:49" in the person's own time. */
export function timeWords(time: Date): string {
  const month = time.toLocaleString("en", { month: "long" });
  return `${WEEKDAYS[time.getDay()]} ${time.getDate()} ${month} ${time.getFullYear()}, ${two(time.getHours())}:${two(time.getMinutes())}`;
}

/** The last exchanges in words, for a session that has not heard them. */
export function exchangesWords(exchanges: readonly Exchange[], last = 3): string[] {
  return exchanges.slice(-last).flatMap((exchange) => {
    const did = exchange.steps.length > 0 ? ` (you did: ${oneLine(exchange.steps.join("; "), 160)})` : "";
    const said = exchange.said ? oneLine(exchange.said, 240) : "(nothing)";
    return [`- They said: “${oneLine(exchange.asked, 200)}”`, `  You said: “${said}”${did}${exchange.interrupted ? " (interrupted by them)" : ""}`];
  });
}

/**
 * The block for one ask. `fresh` when the model has not heard this
 * conversation's start (a new conversation, or a session that could not be
 * resumed): the app list and the names go once, then, not with every ask.
 * `spoke` is the language this ask was heard in, and goes with every ask.
 */
export function contextBlock(moment: Moment, options: { fresh: boolean; earlier?: readonly Exchange[]; spoke?: string | undefined } = { fresh: true }): string {
  const lines: string[] = ["(Not said by the person, from Dashi:"];
  const { window } = moment;
  if (window) {
    const page = window.url ? `, showing ${oneLine(window.url, 200)}` : "";
    lines.push(`In front: ${oneLine(window.app, 40)}${window.title ? `, “${oneLine(window.title, 80)}”` : ""}${page}.`);
  } else lines.push("In front: no window.");
  if (moment.desktop) {
    const { index, of, windows } = moment.desktop;
    lines.push(`Desktop ${index} of ${of} shows, with ${windows === 1 ? "1 window" : `${windows} windows`}.`);
  }
  if (moment.selection?.trim()) lines.push(`Selected text: “${oneLine(moment.selection, SELECTION_MAX)}”`);
  lines.push(`Now: ${timeWords(moment.time)}${moment.language ? `. Session language: ${moment.language}` : ""}.`);
  if (options.fresh) {
    if (moment.apps.length > 0) lines.push(`Apps installed: ${moment.apps.slice(0, APPS_MAX).join(", ")}.`);
    if (moment.about.trim()) lines.push(`What the person had you remember:\n${moment.about.trim()}`);
    if (options.earlier && options.earlier.length > 0) lines.push("Earlier in this conversation:", ...exchangesWords(options.earlier));
  }
  const names = moment.names.length > 0 ? ` The person uses: ${moment.names.join(", ")}.` : "";
  lines.push(`Their words are a transcript of speech and may be wrong; names of apps and sites may be misheard.${names}`);
  const spoke = spokeWords(options.spoke);
  if (spoke) lines.push(spoke);
  lines.push(`${moment.talk})`);
  return lines.join("\n");
}

/** The usual names a transcript gets wrong, as they are written (dictation's corpus: "cloud code", "the dead dash agent", "you tube"). */
export const USUAL_NAMES: readonly string[] = ["Dashi", "Helium", "Claude", "Claude Code", "Codex", "YouTube", "GitHub", "Wi-Fi", "Bluetooth", "MCP"];
