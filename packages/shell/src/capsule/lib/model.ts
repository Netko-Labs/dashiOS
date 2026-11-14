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

/** A card's words, laid out: nothing is answered until its end has been shown (`whole`). */
export interface CardContent {
  kind: "permission" | "question" | "reading";
  /** Who asks and about what: "Dashi asks" and the task it answers. */
  who: string;
  about: string;
  question: string;
  /** The message's lines that show now: from where it was scrolled to, as many as fit. */
  lines: readonly string[];
  choices: readonly string[];
  /** Its end shows, and it can be answered here. When false there is no Yes. */
  whole: boolean;
  /** Its end shows: there is nothing more to scroll to. */
  end: boolean;
  /** What is below, in words ("and 3 more steps"), "" at the end. */
  more: string;
  /** Where "Read it all" scrolls to next (`OpenCard.from`). */
  next: number;
}

/** How many lines of the card `text` takes. */
const linesOf = (text: string): number => text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / CARD.lineChars)), 0);

/** A line too long for one view of the card, cut at words into pieces that each fit one. */
function pieces(line: string): string[] {
  const most = CARD.lineChars * (CARD.lines - 1);
  const cut: string[] = [];
  let rest = line;
  while (rest.length > most) {
    const space = rest.lastIndexOf(" ", most);
    const at = space > most / 2 ? space : most;
    cut.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  return [...cut, rest];
}

/** As many of `all` from `from` as take `budget` lines of the card. */
function take(all: readonly string[], from: number, budget: number): string[] {
  let used = 0;
  const lines: string[] = [];
  for (const line of all.slice(from)) {
    used += linesOf(line);
    if (used > budget) break;
    lines.push(line);
  }
  return lines;
}

/** The view of the message that starts at `from`: what fits, whether its end shows, and what is below. */
function fit(message: readonly string[], unit: string, from: number): Pick<CardContent, "lines" | "end" | "more" | "next"> {
  const all = message.flatMap(pieces);
  const start = Math.min(Math.max(0, from), Math.max(0, all.length - 1));
  const lines = take(all, start, CARD.lines);
  if (start + lines.length >= all.length) return { lines, end: true, more: "", next: start };
  // A line is kept for what is below; every piece fits the rest.
  const shown = take(all, start, CARD.lines - 1);
  const left = all.length - start - shown.length;
  const more = all.length === message.length ? `and ${left} more ${unit}${left === 1 ? "" : "s"}` : "and more below";
  return { lines: shown, end: false, more, next: start + shown.length };
}

/** The task a card answers, in a few words, quoted. */
const aboutOf = (request: string): string => (request.trim() === "" ? "" : `“${head(request, 44)}”`);

/** `from` is how far the card was scrolled (`OpenCard.from`). */
export function cardContent(what: OpenCard["what"], name: string, from = 0): CardContent {
  if ("reading" in what) return readingContent(what.reading, name, from);
  const ask: PillAsk = what.ask;
  if (ask.kind === "permission") {
    const steps = ask.steps.length === 1 ? ask.steps : ask.steps.map((step, index) => `${index + 1}. ${step}`);
    const fitted = fit(steps, "step", from);
    return {
      kind: "permission",
      who: `${name} asks`,
      about: aboutOf(ask.request),
      question: ask.steps.length === 1 ? "Do this?" : `Do these ${ask.steps.length} things?`,
      choices: [],
      ...fitted,
      whole: fitted.end,
    };
  }
  const fitted = fit(ask.text.split("\n"), "line", from);
  const whole = fitted.end && ask.choices.length <= CARD.choices;
  return { kind: "question", who: `${ask.who} asks`, about: aboutOf(ask.about), question: "", choices: whole ? ask.choices : [], ...fitted, whole };
}

function readingContent(reading: Reading, name: string, from: number): CardContent {
  const paragraphs = reading.text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fitted = fit(paragraphs, "paragraph", from);
  return { kind: "reading", who: `${name} says`, about: aboutOf(reading.request), question: "", choices: [], ...fitted, whole: fitted.end };
}

/** An answer this long does not fit the line: it opens in the card. */
export const READING_CHARS = 110;
