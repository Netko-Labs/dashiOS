/**
 * When Dashi drops the act (docs/decisions.md D77): the one rule, and what plain is. While the
 * screen is shared or recorded, during a call, while a window is full screen, and for the first
 * answer after something failed, a character is out of place: Dashi sounds like Dashi (its own
 * character's words, as few as it can) and its dots keep their shape and do not move. Its name,
 * colour, mark, voice and language stay: those are whose it is, not an act. Nothing here is read
 * by a permission, and nothing here widens what a character may do (D58).
 */

import type { Character } from "./characters.ts";
import { DASHI } from "./characters.ts";
import type { PersonaView } from "./resolve.ts";

/** What is going on around Dashi that a character should not play over. */
export interface Circumstances {
  /** Another program is capturing the screen (a meeting, a stream). */
  shared: boolean;
  /** The screen is being recorded, by the person or by an agent. */
  recording: boolean;
  /** A call is on. Not knowable yet: nothing sets it (D77). */
  call: boolean;
  /** A window is full screen: a film, a game, a talk. */
  fullScreen: boolean;
  /** The last thing Dashi was asked failed, and it has not answered since. */
  afterFailure: boolean;
}

export type ActReason = keyof Circumstances;

export const AT_EASE: Circumstances = { shared: false, recording: false, call: false, fullScreen: false, afterFailure: false };

const ORDER: readonly ActReason[] = ["shared", "recording", "call", "fullScreen", "afterFailure"];

/** Why Dashi is plain now, the first reason that holds; null when it may be itself. The one rule. */
export const dropsAct = (now: Circumstances): ActReason | null => ORDER.find((reason) => now[reason]) ?? null;

/** Who Dashi is while plain: the same name and look, Dashi's own words, brief, and still dots. */
export function plain(view: PersonaView): PersonaView {
  const character: Character = { ...DASHI, id: view.character.id, name: view.character.name, voice: view.character.voice };
  return { ...view, character, talk: "less", motion: "still" };
}

/** Who Dashi is in these circumstances: as chosen, or plain. */
export const inCircumstances = (view: PersonaView, now: Circumstances): PersonaView => (dropsAct(now) === null ? view : plain(view));

/** Whether the last task that ended, ended badly: true until a later one is done. Tasks come oldest first. */
export function afterFailure(tasks: ReadonlyArray<{ phase: string }>): boolean {
  const ended = tasks.filter((task) => task.phase === "done" || task.phase === "failed");
  return ended.at(-1)?.phase === "failed";
}
