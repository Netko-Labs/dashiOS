/**
 * Dashi's own assistant on a connection (agents/assistant/; decisions.md
 * D148): the person asked by voice and is at the screen, so what it calls
 * runs, and the exceptions are the ones the registry already marks. A tool
 * marked `destructive` that has no sheet of its own (closing a window,
 * dismissing or clearing notifications, choosing a menu item) gets one
 * spoken yes or no; the ones that ask every time, sign-in and payments keep
 * their own sheets.
 */

import { ASKS_EVERY_TIME } from "../../../actions/tools.ts";
import type { Compositor } from "../../../compositor/index.ts";
import { type Call, TOOLS } from "../../tools/index.ts";

/** How long a spoken yes or no is waited for. */
export const SPOKEN_YES_SECONDS = 30;

/** What the model is told when the person said no, or nothing. */
export const SAID_NO = "The person did not say yes to this. Don't try it again unless they ask; tell them it was not done.";

/** Whether the assistant's call waits for a spoken yes: destructive, and with no sheet of its own. */
export function needsSpokenYes(tool: string): boolean {
  const def = TOOLS.find((each) => each.name === tool);
  return def?.destructive === true && !ASKS_EVERY_TIME.has(def.name) && tool !== "pay";
}

const clean = (text: string, max = 40): string => {
  const flat = text
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** The question for a destructive call, in Dashi's words: "Close the Terminal window?" */
export async function spokenYesWords(call: Call, compositor: Pick<Compositor, "windows">): Promise<string> {
  switch (call.name) {
    case "close_window": {
      const window = (await compositor.windows().catch(() => [])).find((each) => each.id === call.window);
      const app = window ? clean(window.appId.split(".").at(-1) ?? "", 24) : "";
      const title = window ? clean(window.title) : "";
      return title ? `Close the window “${title}”?` : app ? `Close the ${app} window?` : "Close that window?";
    }
    case "dismiss_notification":
      return "Dismiss that notification?";
    case "clear_notifications":
      return "Clear all your notifications?";
    case "choose_menu_item":
      return `Choose “${clean(call.item)}” in the ${clean(call.menu, 24)} menu?`;
    default:
      return `${TOOLS.find((each) => each.name === call.name)?.title ?? "Do this"}?`;
  }
}

const YES = /^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|go on|please do|s[ií]|dale|hazlo|claro|adelante|vale)(?![\p{L}\p{N}])/u;
const NO = /^(?:no|nope|don'?t|do not|cancel|stop|never ?mind|wait|cancela|para|espera|mejor no)(?![\p{L}\p{N}])/u;

/**
 * A yes or a no at the start of what was said or typed ("yes, go ahead and
 * do it"); null for anything else. A no is looked for first: "no, yes" is a no.
 */
export function yesOrNo(heard: string): boolean | null {
  const said = heard
    .toLowerCase()
    .replace(/[.,!?¡¿…"“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (NO.test(said)) return false;
  if (YES.test(said)) return true;
  return null;
}
