/**
 * Landing the words (dictation.ts): tidied by rule, then typed into the
 * field that has the keyboard as one step. While the bar's row is the field
 * they go to it. Where typing can't be done (an X11 window) they are pasted,
 * and the line says so. Where there is nothing to type into, or the window
 * changed, or a password field has the keyboard, nothing is typed: the words
 * wait with Copy. The same when the person clicked or pressed a key in the
 * window after they stopped speaking (`since`): no app tells one field from
 * another well enough (the same field serves the next conversation), so the
 * words are not given to wherever the caret went (decisions.md D81).
 */

import { DICTATION_LIMITS, type DictationState, type WaitReason } from "../../shared/pill/index.ts";
import type { DictationDeps, Front } from "../types.ts";
import { landedLine, waitingLine } from "./lines.ts";
import { type Tidied, tidy } from "./tidy.ts";

/** A key the person still holds is given this long to come up, this many times. */
const KEYS_DOWN_MS = 150;
const KEYS_DOWN_TRIES = 6;

/** A press this little before `since` counts as after it: the shell hears the key come up a moment late. */
const MOVED_SLACK_MS = 60;

/** Where the words belong: the window the listen began in (null: wherever the keyboard is now), and when the person stopped (null: not known). */
export interface Meant {
  at: Front | null;
  since: number | null;
}

/** Whether the person's own hands pressed something in the window since they stopped speaking. */
async function moved(deps: DictationDeps, window: number, since: number | null): Promise<boolean> {
  if (since === null) return false;
  const ago = await deps.pressed(window).catch(() => null);
  if (ago === null) return false;
  const now = deps.now?.() ?? Date.now();
  return ago <= now - since + MOVED_SLACK_MS;
}

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

async function place(deps: DictationDeps, text: string, { at, since }: Meant): Promise<"typed" | "pasted" | WaitReason> {
  const { hub } = deps;
  // The bar's row is the field: the words are its, at its caret.
  if (hub.bar.getSnapshot().mode === "field" && hub.barCommands.send({ do: "insert", text })) return "typed";
  const front = await deps.front();
  if (!front) return "no-field";
  if (at && front.window !== at.window) return "left-window";
  if ((await deps.secret(front)) === true) return "secret";
  if (await moved(deps, front.window, since)) return "moved";
  return type(deps, front.window, text);
}

/** What is typed for the tidied words: a space after them, so the next words (said or typed) do not join them; none after a line break. */
export const withSpace = (typed: string): string => (typed.endsWith("\n") ? typed : `${typed} `);

export async function land(deps: DictationDeps, heard: string, meant: Meant): Promise<Landing> {
  const now = deps.now?.() ?? Date.now();
  const tidied: Tidied = tidy(heard, deps.prefs().tidy);
  const how = await place(deps, withSpace(tidied.typed), meant);
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
