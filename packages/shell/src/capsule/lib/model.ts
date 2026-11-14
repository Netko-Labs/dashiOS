/**
 * What the surface draws, worked out from what the hub says: one thing at a
 * time (types.ts `Shown`), the words that fit a line, and a card's content
 * with its limit. Nothing here draws.
 */

import type { DictationState, PillAsk, VoiceModeState } from "../../shared/pill/index.ts";
import type { OpenCard, Reading, Shown } from "../types.ts";
import { CARD } from "./measures.ts";

/** A 13-point character's width as sentences come out, with a little to spare (the chip measured 5.4 at 12 points). */
const CHAR = 6.4;

/** How many characters fit in `points` of a line. */
export const charsIn = (points: number): number => Math.max(8, Math.floor(points / CHAR));

/** The end of `text` that fits `chars`, from a word's start, led by an ellipsis when cut. */
export function tail(text: string, chars: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= chars) return clean;
  const cut = clean.slice(clean.length - chars + 1);
  const space = cut.indexOf(" ");
  return `…${space >= 0 && space < 12 ? cut.slice(space + 1) : cut}`;
}

/** The start of `text` that fits `chars`, ending with an ellipsis when cut. */
export function head(text: string, chars: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= chars ? clean : `${clean.slice(0, chars - 1).trimEnd()}…`;
}

/**
 * The one thing to draw. A card that is open stays while Dashi listens for
 * its answer; otherwise dictation's capsule goes before Dashi's (the words
 * being typed are the person's own).
 */
export function shownOf(dictation: DictationState, voice: VoiceModeState, card: OpenCard | null): Shown {
  if (card) return { kind: "card", card, listening: voice.phase === "listening" ? voice : null };
  if (dictation.phase !== "idle") return { kind: "dictation", state: dictation };
  if (voice.phase !== "idle") return { kind: "voice", state: voice };
  return { kind: "none" };
}

/** A card's words, laid out: nothing is cut while a button is live (`whole`). */
export interface CardContent {
  kind: "permission" | "question" | "reading";
  /** Who asks and about what: "Dashi asks" and the task it answers. */
  who: string;
  about: string;
  question: string;
  /** The message's lines as they show: all of them when `whole`, else the start. */
  lines: readonly string[];
  choices: readonly string[];
  /** All of it shows. When false there is no Yes: only "Read it all". */
  whole: boolean;
  /** What does not show, in words ("and 3 more steps"), "" when whole. */
  more: string;
}

/** How many lines of the card `text` takes. */
const linesOf = (text: string): number => text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / CARD.lineChars)), 0);

function fit(all: readonly string[], unit: string): Pick<CardContent, "lines" | "whole" | "more"> {
  let used = 0;
  const lines: string[] = [];
  for (const line of all) {
    const takes = linesOf(line);
    if (used + takes > CARD.lines) break;
    used += takes;
    lines.push(line);
  }
  if (lines.length === all.length) return { lines, whole: true, more: "" };
  const first = all[0] ?? "";
  // Not even the first fits: show its start, and say how much more there is.
  if (lines.length === 0) {
    const shown = head(first, CARD.lineChars * (CARD.lines - 1));
    return { lines: [shown], whole: false, more: `and ${first.length - shown.length + 1} more characters` };
  }
  // A line is kept for what is left out.
  const shown = lines.slice(0, Math.min(lines.length, CARD.lines - 1));
  const left = all.length - shown.length;
  return { lines: shown, whole: false, more: `and ${left} more ${unit}${left === 1 ? "" : "s"}` };
}

/** The task a card answers, in a few words, quoted. */
const aboutOf = (request: string): string => (request.trim() === "" ? "" : `“${head(request, 44)}”`);

export function cardContent(what: OpenCard["what"], name: string): CardContent {
  if ("reading" in what) return readingContent(what.reading, name);
  const ask: PillAsk = what.ask;
  if (ask.kind === "permission") {
    const steps = ask.steps.length === 1 ? ask.steps : ask.steps.map((step, index) => `${index + 1}. ${step}`);
    return {
      kind: "permission",
      who: `${name} asks`,
      about: aboutOf(ask.request),
      question: ask.steps.length === 1 ? "Do this?" : `Do these ${ask.steps.length} things?`,
      choices: [],
      ...fit(steps, "step"),
    };
  }
  const fitted = fit([ask.text], "line");
  const whole = fitted.whole && ask.choices.length <= CARD.choices;
  return { kind: "question", who: `${ask.who} asks`, about: aboutOf(ask.about), question: "", choices: whole ? ask.choices : [], ...fitted, whole };
}

function readingContent(reading: Reading, name: string): CardContent {
  const paragraphs = reading.text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { kind: "reading", who: `${name} says`, about: aboutOf(reading.request), question: "", choices: [], ...fit(paragraphs, "paragraph") };
}

/** An answer this long does not fit the line: it opens in the card. */
export const READING_CHARS = 110;
