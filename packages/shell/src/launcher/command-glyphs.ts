/**
 * Glyphs for Dashi's own commands in the launcher (actions/sources/commands.ts),
 * drawn in ink on a neutral tile like the Settings panes' (CO-2): the moon,
 * lock and keyboard are the ones Control Center and Settings already draw;
 * the power, restart, log out and force quit glyphs are new, in their style
 * (16 × 16, 1.4 strokes, round ends).
 */

import { LOCK, MOON } from "../control-center/glyphs.ts";
import { LOGO } from "../glyphs.ts";
import { KEYBOARD } from "../settings-app/glyphs.ts";

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`;
const stroke = (d: string, width = 1.4) => `<path d="${d}" stroke="#000" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Shut Down: the power sign. */
export const POWER = svg(stroke("M5.2 4.4a5 5 0 1 0 5.6 0") + stroke("M8 2.2v5.2"));
/** Restart: a circle that comes back on itself. */
export const RESTART = svg(stroke("M12.8 8.4a4.8 4.8 0 1 1-1.6-3.9") + stroke("M11.6 2v2.9H8.7"));
/** Log Out: a door, and the way out of it. */
export const LOG_OUT = svg(stroke("M7.2 2.6H3.4v10.8h3.8") + stroke("M6.6 8h6.8") + stroke("M10.8 5.4L13.4 8l-2.6 2.6"));
/** Force Quit: a stop, crossed. */
export const FORCE_QUIT = svg(`<circle cx="8" cy="8" r="5.8" stroke="#000" stroke-width="1.4" fill="none"/>${stroke("M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2")}`);

/** The glyph for `dashi://dashi/<command>`, by its command id; undefined for one without (System Settings is its app). */
export const COMMAND_GLYPHS: Readonly<Record<string, string>> = {
  about: LOGO,
  "force-quit": FORCE_QUIT,
  sleep: MOON,
  restart: RESTART,
  "shut-down": POWER,
  "lock-screen": LOCK,
  "log-out": LOG_OUT,
  shortcuts: KEYBOARD,
};
