/** The input tools' pure parts: a long scroll as wheel flicks, and the words of a refusal. */

import { type ToolResult, toolError } from "../../context.ts";
import { type PersonBusy, QUIET_MS, WAIT_MS } from "../hands.ts";

/**
 * A long scroll is played as a wheel spun fast: flicks of at most 120 pixels
 * (8 notches), a frame apart, never one event of hundreds of notches, which
 * no wheel sends (a 2400 pixel one came right before the display froze,
 * review 20). The tool keeps a scroll within 10 000 pixels (tools/lib/input.ts).
 */
const WHEEL_FLICK_PX = 120;

/** A scroll of (dx, dy) as the wheel flicks that play it, in order; none for (0, 0). */
export function wheelFlicks(dx: number, dy: number): Array<{ dx: number; dy: number }> {
  const count = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / WHEEL_FLICK_PX);
  // Even shares, so the last flick isn't a stub.
  return Array.from({ length: count }, () => ({ dx: dx / count, dy: dy / count }));
}

/**
 * Why press_keys refused a chord the desktop keeps, and what does it instead:
 * ❖Q is the shell's Quit (keymap.ts `quit-app`), which an agent reaches
 * through the app's menu.
 */
export function desktopChordRefusal(shortcut: string, binding: string | null): string {
  const instead =
    binding === "quit-app"
      ? "to quit the app, choose_menu_item its app menu's Quit (list_menus names it), or close_window"
      : "use the window tools (focus_window, close_window, …) instead";
  return `${shortcut} is the desktop's own shortcut, not the window's; ${instead}.`;
}

const seconds = (ms: number) => `${Math.max(1, Math.ceil(ms / 1000))} s`;

/** Why nothing was done, and how long to wait: the agent may act QUIET_MS after the person's last input. */
export function describePerson(error: PersonBusy): ToolResult {
  const rule = `an agent may act once the person has left it alone for ${seconds(QUIET_MS)}`;
  return toolError(
    error.desktop
      ? `The person is using the desktop and didn't pause within ${seconds(WAIT_MS)}, so nothing was done; ${rule}. Wait at least ${seconds(error.waitMs)} and try again.`
      : `The person is using w${error.window}, so nothing was done; ${rule}. Wait at least ${seconds(error.waitMs)} and try again, or work in another window.`,
  );
}
