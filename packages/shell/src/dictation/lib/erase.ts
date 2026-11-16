/**
 * Taking back what Dashi typed (record.ts; decisions.md D180): BackSpace,
 * once for each character Dashi sent (in one `type-text` request, so they
 * arrive in order with whatever is typed next), and only when those characters are
 * still the last thing in the field. Where the field can be read (AT-SPI),
 * the text before the caret must end with them. Where it can't (most
 * terminals), the person's own hands must not have pressed a key or a
 * button in the window since they landed, which the compositor knows for
 * certain, and the text must hold no line break (a Return there is a
 * command that ran). Otherwise nothing is touched and the capsule says so.
 * Never the person's own text.
 */

import type { DictationDeps } from "../types.ts";
import type { Insertion } from "./record.ts";
import { backspace } from "./type.ts";

export type Erased = "erased" | "changed" | "left-window" | "failed";

/** A press this little after the landing is the key that dictated coming up. */
const SLACK_MS = 60;

const points = (text: string): number => [...text].length;

/** How many BackSpaces take `typed` back from a field whose text before the caret is `before`; null when it is not there any more. */
export function eraseCount(typed: string, before: string): number | null {
  const field = before.replace(/\r\n/g, "\n");
  if (field.endsWith(typed)) return points(typed);
  // An app that dropped the space Dashi typed last (a field that trims) still ends with the words.
  const words = typed.trimEnd();
  if (words !== "" && field.endsWith(words)) return points(words);
  return null;
}

async function untouched(deps: DictationDeps, entry: Insertion): Promise<boolean> {
  if (entry.typed.includes("\n")) return false;
  const ago = await deps.pressed(entry.window).catch(() => null);
  if (ago === null) return true;
  const now = deps.now?.() ?? Date.now();
  return ago > now - entry.at + SLACK_MS;
}

/** Take `entry` back, if it is still what the field ends with. */
export async function erase(deps: DictationDeps, entry: Insertion): Promise<Erased> {
  const front = await deps.front().catch(() => null);
  if (!front || front.window !== entry.window) return "left-window";
  const field = await deps.field(front).catch(() => null);
  if (field?.kind === "password") return "changed";
  let count: number | null;
  if (field && field.before !== null) count = eraseCount(entry.typed, field.before);
  else count = (await untouched(deps, entry)) ? points(entry.typed) : null;
  if (count === null) return "changed";
  return (await backspace(deps, entry.window, count)) ? "erased" : "failed";
}
