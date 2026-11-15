/**
 * What can be done with a dictation after it landed (dictation.ts): Undo
 * takes it back, Raw lands the recogniser's words in its place, and "paste
 * last" types it again where the keyboard is now. Each acts on the
 * insertion record (record.ts) and says what it did in one line; one that
 * could not be done safely touches nothing and says so.
 */

import { DICTATION_LIMITS, type DictationState } from "../../shared/pill/index.ts";
import type { DictationDeps } from "../types.ts";
import { type Erased, erase } from "./erase.ts";
import { fieldIn, typeAndRemember, withSpace } from "./land.ts";
import { waitingLine } from "./lines.ts";
import type { Insertion, Insertions } from "./record.ts";

const now = (deps: DictationDeps): number => deps.now?.() ?? Date.now();

export function told(deps: DictationDeps, line: string, tone: "ok" | "warn" = "ok", undo = false): DictationState {
  return { phase: "told", line, tone, ...(undo ? { undo: true } : {}), until: now(deps) + DICTATION_LIMITS.notice };
}

const NOT_ERASED: Readonly<Record<Exclude<Erased, "erased">, string>> = {
  changed: "That text has changed, so I left it.",
  "left-window": "That was typed in another window. I left it.",
  failed: "Couldn't take that back.",
};

/** Why `entry` was not taken back, in the capsule's words. */
export const notErasedLine = (why: Exclude<Erased, "erased">): string => NOT_ERASED[why];

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** "Removed 14 words." */
export const removedLine = (text: string): string => {
  const count = wordCount(text);
  return `Removed ${count} ${count === 1 ? "word" : "words"}.`;
};

/** Undo: the newest insertion in the window in front is taken back, if it is still there. */
export async function undo(deps: DictationDeps, kept: Insertions): Promise<DictationState> {
  const front = await deps.front().catch(() => null);
  const entry = front ? kept.top(front.window) : kept.top();
  if (!entry) return told(deps, "Nothing of mine to take back.", "warn");
  const went = await erase(deps, entry);
  if (went !== "erased") {
    // Changed is for good: the field moved on, and the entry is no longer Dashi's to take back.
    if (went === "changed") kept.drop(entry.id);
    return told(deps, notErasedLine(went), "warn");
  }
  kept.drop(entry.id);
  deps.history?.mark(entry.id, "undone");
  return told(deps, removedLine(entry.text));
}

/** Raw: the recogniser's own words in place of the tidied ones. */
export async function raw(deps: DictationDeps, kept: Insertions, id: string | null): Promise<DictationState> {
  const entry = id ? kept.get(id) : null;
  if (!entry || entry.heard === entry.text) return told(deps, "Nothing to change back.", "warn");
  const went = await erase(deps, entry);
  if (went !== "erased") {
    if (went === "changed") kept.drop(entry.id);
    return told(deps, notErasedLine(went), "warn");
  }
  kept.drop(entry.id);
  deps.history?.mark(entry.id, "raw");
  return typeAgain(deps, kept, { ...entry, text: entry.heard, typed: entryTyped(entry, entry.heard) }, "As you said it.");
}

/** `text` with the space Dashi put before and after the words of `entry`. */
function entryTyped(entry: Insertion, text: string): string {
  const lead = /^\s*/.exec(entry.typed)?.[0] ?? "";
  const trail = /[ \t]*$/.exec(entry.typed)?.[0] ?? "";
  return `${lead.replace(/\n/g, "")}${text}${text.endsWith("\n") ? "" : trail}`;
}

async function typeAgain(deps: DictationDeps, kept: Insertions, like: Insertion, said: string): Promise<DictationState> {
  const front = await deps.front().catch(() => null);
  if (!front) return told(deps, waitingLine("no-field"), "warn");
  const field = await fieldIn(deps, front);
  if (field?.kind === "password") return told(deps, "That is a password field. Nothing typed.", "warn");
  const what = { heard: like.heard, text: like.text, typed: like.typed, profile: like.profile, breaks: like.breaks };
  const { how, entry } = await typeAndRemember(deps, kept, { front, field }, what);
  if (how !== "typed" && how !== "pasted") return told(deps, "Couldn't type that.", "warn");
  return {
    phase: "landed",
    typed: like.text,
    heard: like.heard,
    changes: [],
    line: `${how === "pasted" ? "Pasted." : "Typed."} ${said}`,
    until: now(deps) + DICTATION_LIMITS.landed,
    undo: entry !== null,
    raw: false,
    ...(like.profile ? { profile: like.profile } : {}),
  };
}

/** "Paste last": the last dictation again, where the keyboard is now (`last` is its words when it never landed). */
export async function pasteLast(deps: DictationDeps, kept: Insertions, last: { heard: string; text: string } | null): Promise<DictationState> {
  if (!last) return told(deps, "Nothing dictated yet.", "warn");
  const like: Insertion = {
    id: "",
    at: 0,
    window: 0,
    pid: null,
    app: "",
    field: "",
    heard: last.heard,
    text: last.text,
    typed: withSpace(last.text),
    how: "typed",
    profile: "",
    readable: false,
    breaks: null,
  };
  return typeAgain(deps, kept, like, "Your last dictation.");
}
