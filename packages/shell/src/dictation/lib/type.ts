/**
 * Putting characters into a window (land.ts): the compositor's `type-text`,
 * waiting out a key the person still holds; pasted where typing can't be
 * done (an X11 window). In a field where Return sends (a chat, an agent's
 * prompt) a line break is typed as ⇧Return, which every such field takes
 * as a line break (`soft`).
 */

import type { WaitReason } from "../../shared/pill/index.ts";
import type { DictationDeps } from "../types.ts";

/** A key the person still holds is given this long to come up, this many times. */
const KEYS_DOWN_MS = 150;
const KEYS_DOWN_TRIES = 6;

export type Typed = "typed" | "pasted" | WaitReason;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Type, waiting out a key still held; then how it went. */
async function typeOnce(deps: DictationDeps, window: number, text: string): Promise<Typed> {
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

/** `text` into `window`; with `soft`, each line break is ⇧Return. */
export async function typeInto(deps: DictationDeps, window: number, text: string, soft: boolean): Promise<Typed> {
  if (!soft || !text.includes("\n")) return typeOnce(deps, window, text);
  const lines = text.split("\n");
  let how: Typed = "typed";
  for (const [nth, line] of lines.entries()) {
    if (nth > 0) {
      try {
        await deps.sendKeys(window, "shift+Return");
      } catch {
        return nth === 0 ? "failed" : how;
      }
    }
    if (line === "") continue;
    const went = await typeOnce(deps, window, line);
    // Pasted (an X11 window): the rest goes as one paste would have.
    if (went !== "typed" && went !== "pasted") return went;
    how = went;
  }
  return how;
}
