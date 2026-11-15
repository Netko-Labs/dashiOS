/**
 * Putting characters into a window (land.ts): the compositor's `type-text`,
 * waiting out a key the person still holds; pasted where typing can't be
 * done (an X11 window). In a field where Return sends (a chat) a line break
 * is typed as ⇧Return, and in an agent's prompt in a terminal as ⌃J, which
 * such fields take as a line break that does not send.
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

/** `text` into `window`; with `breaks`, each line break is that chord (⇧Return, or ⌃J in an agent's prompt) in place of Return. */
export async function typeInto(deps: DictationDeps, window: number, text: string, breaks: string | null): Promise<Typed> {
  if (!breaks || !text.includes("\n")) return typeOnce(deps, window, text);
  const lines = text.split("\n");
  let how: Typed = "typed";
  for (const [nth, line] of lines.entries()) {
    if (nth > 0) {
      try {
        await deps.sendKeys(window, breaks);
      } catch {
        return "failed";
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
