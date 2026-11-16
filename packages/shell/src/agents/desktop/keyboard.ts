/**
 * Which kind of field has the keyboard in an app's window, where
 * accessibility (AT-SPI) tells: the last focus event the app sent, checked to
 * still hold the focus. Never a field's name or value: only its kind, so an
 * agent knows whether typing will land in a field before it types.
 * Bounded in time: a slow accessibility bus costs a call at most a second.
 */

import { fieldAt } from "../atspi/index.ts";
import type { RunContext } from "../context.ts";

export type KeyboardAt = "text field" | "password field" | "no text field";

const within = <T>(work: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([work.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/** What has the keyboard in the app that runs as `pid`; null when accessibility can't tell (none, or the app never said). */
export async function keyboardIn(pid: number | null, ctx: Pick<RunContext, "secrets">): Promise<KeyboardAt | null> {
  if (pid === null) return null;
  let connecting: ReturnType<RunContext["secrets"]["atspi"]>;
  try {
    connecting = ctx.secrets.atspi();
  } catch {
    return null;
  }
  const atspi = await within(connecting, 600);
  if (!atspi) return null;
  const leaf = await within(atspi.focusedIn(pid), 300);
  if (!leaf) return null;
  const field = await within(fieldAt(leaf), 300);
  if (!field) return "no text field";
  return field.kind === "password" ? "password field" : field.kind === "text" ? "text field" : "no text field";
}

/** The sentence after a click: where typing would go now. */
export function keyboardWords(at: KeyboardAt | null): string {
  if (at === null) return "";
  if (at === "no text field") return " No text field has the keyboard there: type_text would not land in a field.";
  return ` A ${at} has the keyboard there now.`;
}
