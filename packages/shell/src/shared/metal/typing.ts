/**
 * Whether a text field in the app's window has the keyboard: the Metal host
 * says so when it changes (`{"type":"typing","nodeId":"root","typing"}`,
 * mirin's docs/metal.md), and a window opens with none. The kit hands it to
 * the menus channel, so ❖A in a rename field selects its text instead of
 * choosing Edit › Select All (menus.ts `setTyping`). A host older than the
 * event never sends it: the app's rows keep the chords, as before.
 */

import { isRecord } from "@dashi/shape";
import type { NativeTransport } from "@mirinjs/metal";

/** `typing` from one of the host's events, or null for any other event. */
export function typingOf(event: unknown): boolean | null {
  if (!isRecord(event)) return null;
  const fields = event;
  if (fields.type !== "typing" || fields.nodeId !== "root" || typeof fields.typing !== "boolean") return null;
  return fields.typing;
}

/** Calls `listener` whenever a field takes the keyboard (`true`) or the last one lets it go. */
export function onWindowTyping(host: Pick<NativeTransport, "onEvent">, listener: (typing: boolean) => void): void {
  let typing = false;
  host.onEvent((event) => {
    const now = typingOf(event);
    if (now === null || now === typing) return;
    typing = now;
    listener(typing);
  });
}
