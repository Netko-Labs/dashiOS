/**
 * Carrying out an instruction said as a whole utterance (landings.ts;
 * instruction.ts): "scratch that" takes back Dashi's newest insertion in
 * the window in front, checked as Undo checks it; "new line" breaks the
 * line as the place breaks lines. The capsule says "Took that as an
 * instruction", with Undo, which puts things back and types the words
 * instead (landings.ts).
 */

import { DICTATION_LIMITS, type DictationState } from "../../shared/pill/index.ts";
import type { DictationDeps } from "../types.ts";
import { notErasedLine, removedLine } from "./after.ts";
import { erase } from "./erase.ts";
import type { Instruction } from "./instruction.ts";
import { breaksIn, type LandContext, type Meant, spotFor, typeAndRemember } from "./land.ts";
import { waitingLine } from "./lines.ts";
import type { Insertion } from "./record.ts";

/** What an instruction did, kept so Undo can put it back. */
export interface Instructed {
  state: DictationState;
  /** What "scratch that" removed; null when nothing was. */
  removed: Insertion | null;
  /** The line break "new line" typed; null when none was. */
  typed: Insertion | null;
}

const said = (deps: DictationDeps, line: string, tone: "ok" | "warn"): DictationState => ({
  phase: "told",
  line,
  tone,
  undo: true,
  until: (deps.now?.() ?? Date.now()) + DICTATION_LIMITS.landed,
});

const TOOK = "Took that as an instruction.";

async function scratch(deps: DictationDeps, ctx: LandContext): Promise<Instructed> {
  const front = await deps.front().catch(() => null);
  const entry = front ? ctx.kept.top(front.window) : null;
  if (!entry) return { state: said(deps, "Nothing of mine to take back.", "warn"), removed: null, typed: null };
  const went = await erase(deps, entry);
  if (went !== "erased") {
    if (went === "changed") ctx.kept.drop(entry.id);
    return { state: said(deps, notErasedLine(went), "warn"), removed: null, typed: null };
  }
  ctx.kept.drop(entry.id);
  deps.history?.mark(entry.id, "undone");
  return { state: said(deps, `${TOOK} ${removedLine(entry.text)}`, "ok"), removed: entry, typed: null };
}

async function lineBreak(deps: DictationDeps, ctx: LandContext, text: string, meant: Meant): Promise<Instructed> {
  const where = await spotFor(deps, meant);
  if (typeof where === "string") return { state: said(deps, waitingLine(where).replace(" Your words wait here.", ""), "warn"), removed: null, typed: null };
  const { breaks, profile } = await breaksIn(deps, ctx, where.front, where.field);
  const what = { heard: text === "\n" ? "new line" : "new paragraph", text, typed: text, profile, breaks };
  const { how, entry } = await typeAndRemember(deps, ctx.kept, where, what);
  if (how !== "typed" && how !== "pasted") return { state: said(deps, "Couldn't type that.", "warn"), removed: null, typed: null };
  return { state: said(deps, `${TOOK} ${text === "\n" ? "A new line." : "A new paragraph."}`, "ok"), removed: null, typed: entry };
}

export function carryOut(deps: DictationDeps, ctx: LandContext, instruction: Instruction, meant: Meant): Promise<Instructed> {
  return instruction.kind === "erase" ? scratch(deps, ctx) : lineBreak(deps, ctx, instruction.text, meant);
}
