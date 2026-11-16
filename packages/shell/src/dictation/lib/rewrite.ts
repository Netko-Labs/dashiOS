/**
 * The correction model's seat (land.ts; docs/dictation-rewrite.md; research
 * 3.1, stage 3): after the rules and the gate, the rewriter (rewrite/) is
 * asked with the vocabulary, under the deadline it advises. The seam also
 * carries the profile's tone and the text before the caret; the model that
 * ships is sent neither (it scored lower with them, D173), so the fit to
 * the field stays a rule made after its answer (fit.ts). Only an answer that is text changes anything;
 * "unchanged", a failure or the deadline land the rules' words. With no
 * rewriter, or no model on this computer, nothing is asked at all.
 */

import type { RewriteReply, RewriteRequest, Rewriter } from "../../rewrite/index.ts";
import type { DictationDeps } from "../types.ts";
import { type Composed, type Composing, isShell, restyle } from "./compose.ts";
import { type GateReason, gate } from "./gate.ts";
import { languagesOf } from "./language.ts";

/**
 * The reasons the model is asked for. Measured on its evaluation set (docs/dictation-rewrite.md): it takes back what the
 * speaker took back and leaves right sentences alone, but it does not mend a non-word (5%), and its checks refuse an
 * answer that adds a line break, so it never lays out a list. Those two reasons stay the gate's to name and are not
 * worth the wait: non-words and lists are the rules' (rules-terms.ts, lists.ts).
 */
const HELPED: ReadonlySet<GateReason> = new Set<GateReason>(["cue", "run-on", "near-term", "polish"]);

/** How many names the model is given: its prompt's length is the wait. */
const MOST_TERMS = 50;

export interface Asking {
  made: Composed;
  composing: Composing;
  /** The text before the caret, "" when not known. */
  before: string;
  reasons: readonly GateReason[];
}

/** Why the model should be asked about what the rules made; empty at a shell's prompt, in Verbatim, or with tidying off. */
export function reasonsFor(made: Composed, composing: Composing): GateReason[] {
  const { profile } = composing.place;
  if (!composing.tidy || !profile.tidy || isShell(composing) || made.text.trim() === "") return [];
  return gate({ text: made.text, listed: made.listed, terms: made.terms, words: composing.words, polish: profile.polish }).filter((reason) =>
    HELPED.has(reason),
  );
}

export function requestFor(deps: DictationDeps, asking: Asking, deadlineMs: number, signal?: AbortSignal): RewriteRequest {
  return {
    transcript: asking.made.text,
    languages: languagesOf(asking.made.text, asking.before, deps.language),
    vocabulary: asking.made.terms.slice(0, MOST_TERMS).map((each) => each.term),
    before: asking.before.slice(-200),
    tone: asking.composing.place.profile.tone,
    deadlineMs,
    ...(signal ? { signal } : {}),
  };
}

const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) ?? [];

/** How many words differ between two texts, whichever way is more. */
export function wordsChanged(from: string, to: string): number {
  const left = new Map<string, number>();
  for (const word of wordsOf(from)) left.set(word, (left.get(word) ?? 0) + 1);
  let added = 0;
  for (const word of wordsOf(to)) {
    const have = left.get(word) ?? 0;
    if (have > 0) left.set(word, have - 1);
    else added++;
  }
  const gone = [...left.values()].reduce((sum, count) => sum + count, 0);
  return Math.max(added, gone);
}

const plain = (word: string): string => word.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/**
 * The model's answer with the speaker's own spelling of each word it kept: a word that differs from one that was said
 * only by its accents ("mandame" for "mándame", "esta" for "está") is written as it was said. The model takes words
 * back (D174); it does not respell the ones that stay.
 */
export function keepAccents(said: string, answer: string): string {
  const words = said.match(/[\p{L}\p{N}'’]+/gu) ?? [];
  const spoken = new Map<string, string>();
  for (const word of words) if (!spoken.has(plain(word))) spoken.set(plain(word), word);
  const exact = new Set(words.map((word) => word.toLowerCase()));
  return answer.replace(/[\p{L}\p{N}'’]+/gu, (word) => {
    const was = spoken.get(plain(word));
    if (was === undefined || exact.has(word.toLowerCase()) || was.toLowerCase() === word.toLowerCase()) return word;
    // The answer's own capital stays: the word may start the sentence now.
    return /^\p{Lu}/u.test(word) ? was.charAt(0).toUpperCase() + was.slice(1) : was.charAt(0).toLowerCase() + was.slice(1);
  });
}

/** What the rules made, with the model's answer in place of their text: styled again as the profile wants, and counted. */
export function withModel(made: Composed, answer: string, composing: Composing): Composed {
  const text = restyle(keepAccents(made.text, answer.trim()), composing, made.terms).text;
  if (text === "" || text === made.text) return made;
  // Marks alone changed (a comma, a capital): still a fix the person can see.
  const count = Math.max(1, wordsChanged(made.text, text));
  return { ...made, text, changes: [...made.changes, { kind: "model", count }] };
}

/** Whether there is a model to ask at all: none when it is off, absent, or too slow for this machine. */
export function usable(rewriter: Rewriter | undefined): rewriter is Rewriter {
  if (!rewriter) return false;
  const state = rewriter.state();
  return state !== "off" && state !== "no-model" && state !== "too-slow";
}

export interface Corrected {
  made: Composed;
  /** The rules' text should land now and be replaced when the model answers (a machine too slow to wait on). */
  refine: boolean;
  /** What the model said, for the history: "text", "unchanged", a failure's kind; "" when it was not asked. */
  model: string;
}

const said = (reply: RewriteReply): string => (reply.kind === "failed" ? reply.why : reply.kind);

/** The model's answer for what the rules made, when the gate says to ask and this machine can wait for it. */
export async function correct(deps: DictationDeps, asking: Asking): Promise<Corrected> {
  const { rewriter } = deps;
  if (asking.reasons.length === 0 || !usable(rewriter)) return { made: asking.made, refine: false, model: "" };
  const advice = rewriter.advice(asking.made.text);
  if (advice.land === "refine") return { made: asking.made, refine: true, model: "" };
  const reply = await rewriter.rewrite(requestFor(deps, asking, advice.deadlineMs)).catch((): RewriteReply | null => null);
  if (!reply) return { made: asking.made, refine: false, model: "gone" };
  return { made: reply.kind === "text" ? withModel(asking.made, reply.text, asking.composing) : asking.made, refine: false, model: said(reply) };
}
