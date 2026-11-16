/**
 * Putting characters into a window (land.ts): the compositor's `type-text`,
 * waiting out a key the person still holds; pasted where typing can't be
 * done (an X11 window). In a field where Return sends (a chat) a line break
 * is typed as ⇧Return, and in an agent's prompt in a terminal as ⌃J, which
 * such fields take as a line break that does not send. The chord rides with
 * the text in the one request, so it lands between the lines it separates:
 * a chord sent apart goes through the input method and arrives late
 * (measured in the VM with fcitx5: the break landed after the next line).
 */

import type { WaitReason } from "../../shared/pill/index.ts";
import type { DictationDeps } from "../types.ts";

/** A key the person still holds is given this long to come up, this many times. */
const KEYS_DOWN_MS = 150;
const KEYS_DOWN_TRIES = 6;

export type Typed = "typed" | "pasted" | WaitReason;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** `text` into `window`, waiting out a key still held; with `breaks`, each line break is that chord in place of Return. Then how it went. */
export async function typeInto(deps: DictationDeps, window: number, text: string, breaks: string | null): Promise<Typed> {
  const timers = deps.timers;
  const how = breaks && text.includes("\n") ? { breaks } : undefined;
  for (let tries = 0; ; tries++) {
    try {
      await deps.typeText(window, text, how);
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

/** BackSpace `count` times into `window`, in one request; one key at a time where `type-text` can't be used (an X11 window). */
export async function backspace(deps: DictationDeps, window: number, count: number): Promise<boolean> {
  const timers = deps.timers;
  for (let tries = 0; ; tries++) {
    try {
      await deps.typeText(window, "", { erase: count });
      return true;
    } catch (error) {
      const refusal = message(error);
      if (refusal.includes("keys-down") && tries < KEYS_DOWN_TRIES && timers) {
        await new Promise<void>((resolve) => timers.set(resolve, KEYS_DOWN_MS));
        continue;
      }
      if (!refusal.includes("x11")) return false;
      try {
        for (let sent = 0; sent < count; sent++) await deps.sendKeys(window, "BackSpace");
        return true;
      } catch {
        return false;
      }
    }
  }
}
