/**
 * Landing the words (dictation.ts): tidied by rule, then typed into the
 * field that has the keyboard as one step. While the bar's row is the field
 * they go to it. Where typing can't be done (an X11 window) they are pasted,
 * and the line says so. Where there is nothing to type into, or the window
 * changed, or a password field has the keyboard, nothing is typed: the words
 * wait with Copy.
 */

import { DICTATION_LIMITS, type DictationState, type WaitReason } from "../../shared/pill/index.ts";
import type { DictationDeps, Front } from "../types.ts";
import { landedLine, waitingLine } from "./lines.ts";
import { type Tidied, tidy } from "./tidy.ts";

/** A key the person still holds is given this long to come up, this many times. */
const KEYS_DOWN_MS = 150;
const KEYS_DOWN_TRIES = 6;

export interface Landing {
  state: DictationState;
  typed: boolean;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Type, waiting out a key still held; then how it went. */
async function type(deps: DictationDeps, window: number, text: string): Promise<"typed" | "pasted" | WaitReason> {
  const timers = deps.timers;
  for (let tries = 0; ; tries++) {
    try {
      await deps.typeText(window, text);
      return "typed";
    } catch (error) {
      const refusal = message(error);
      if (refusal.includes("left-window") || refusal.includes("no window")) return "left-window";
      if (refusal.includes("locked")) return "failed";
      if (refusal.includes("keys-down") && tries < KEYS_DOWN_TRIES && timers) {
        await new Promise<void>((resolve) => timers.set(resolve, KEYS_DOWN_MS));
        continue;
      }
      return (await deps.paste(window, text)) ? "pasted" : "failed";
    }
  }
}

async function place(deps: DictationDeps, text: string, at: Front | null): Promise<"typed" | "pasted" | WaitReason> {
  const { hub } = deps;
  // The bar's row is the field: the words are its, at its caret.
  if (hub.bar.getSnapshot().mode === "field" && hub.barCommands.send({ do: "insert", text })) return "typed";
  const front = await deps.front();
  if (!front) return "no-field";
  if (at && front.window !== at.window) return "left-window";
  if ((await deps.secret(front)) === true) return "secret";
  return type(deps, front.window, text);
}

/** `at` is the window the key went down in (null: wherever the keyboard is now). `lead` goes before the words (the space between two sentences). */
export async function land(deps: DictationDeps, heard: string, at: Front | null, lead = ""): Promise<Landing> {
  const now = deps.now?.() ?? Date.now();
  const tidied: Tidied = tidy(heard, deps.prefs().tidy);
  // A sentence that starts on a new line needs no space before it.
  const how = await place(deps, (tidied.typed.startsWith("\n") ? "" : lead) + tidied.typed, at);
  if (how === "typed" || how === "pasted") {
    const line = landedLine(tidied.changes, how, tidied.asHeard);
    return {
      typed: true,
      state: { phase: "landed", typed: tidied.typed, heard: tidied.heard, changes: tidied.changes, line, until: now + DICTATION_LIMITS.landed },
    };
  }
  return {
    typed: false,
    state: { phase: "waiting", text: tidied.typed, heard: tidied.heard, reason: how, line: waitingLine(how), until: now + DICTATION_LIMITS.waiting },
  };
}
