/**
 * Glyphs for Dashi's own commands in the launcher (actions/sources/commands.ts,
 * the clipboard's, the window arrangements, the agents' tools a person runs),
 * drawn in ink on a neutral tile like the Settings panes' (CO-2): the moon,
 * lock, keyboard, clipboard and snippet are the ones Control Center, Settings
 * and the clipboard already draw, the screen and the area the ⇧❖5 toolbar's;
 * the rest are new, in their style (16 × 16, 1.4 strokes, round ends). No
 * command of Dashi's falls back to the gear.
 */

import { LOGO } from "@dashi/ui";
import { CLIPBOARD, SNIPPET } from "../clipboard/glyphs.ts";
import { LOCK, MOON } from "../control-center/glyphs.ts";
import { CAPTURE_GLYPHS } from "../recorder/glyphs.ts";
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
/** Screenshot… (the ⇧❖5 toolbar): a camera, its top and its lens. */
export const CAMERA = svg(
  `<rect x="1.8" y="4.4" width="12.4" height="9" rx="1.8" stroke="#000" stroke-width="1.4" fill="none"/>` +
    stroke("M5.4 4.4l1-1.8h3.2l1 1.8") +
    `<circle cx="8" cy="8.9" r="2.4" stroke="#000" stroke-width="1.4" fill="none"/>`,
);

/** Clear Clipboard History: the clipboard, its lines crossed out. */
export const CLEAR_CLIPBOARD = svg(
  stroke("M5.4 3H4.2a1.2 1.2 0 0 0-1.2 1.2v8.6A1.2 1.2 0 0 0 4.2 14h7.6a1.2 1.2 0 0 0 1.2-1.2V4.2A1.2 1.2 0 0 0 11.8 3h-1.2") +
    stroke("M6 2h4v2.2H6z") +
    stroke("M6.4 7.4l3.2 3.2M9.6 7.4l-3.2 3.2"),
);
/** Clear notifications: a banner and the one behind it, crossed. */
export const CLEAR_NOTIFICATIONS = svg(
  `<rect x="2.2" y="5" width="11.6" height="7.6" rx="1.8" stroke="#000" stroke-width="1.4" fill="none"/>` +
    stroke("M4.4 2.8h7.2") +
    stroke("M6.6 7.4l2.8 2.8M9.4 7.4l-2.8 2.8"),
);

/** A window's frame, the arrangements' common ground. */
const FRAME = `<rect x="2" y="3" width="12" height="10" rx="1.6" stroke="#000" stroke-width="1.4" fill="none"/>`;
const part = (x: number, y: number, width: number, height: number) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="0.6" fill="#000"/>`;
/** Tile left, right, up and down: the frame, and the half the window takes. */
export const TILE_LEFT = svg(FRAME + part(3.6, 4.6, 3.8, 6.8));
export const TILE_RIGHT = svg(FRAME + part(8.6, 4.6, 3.8, 6.8));
export const TILE_UP = svg(FRAME + part(3.6, 4.6, 8.8, 2.8));
export const TILE_DOWN = svg(FRAME + part(3.6, 8.6, 8.8, 2.8));
/** Fill the screen: the window takes all of it. */
export const TILE_FILL = svg(FRAME + part(3.6, 4.6, 8.8, 6.8));
/** Center: a smaller window in the middle. */
export const TILE_CENTER = svg(FRAME + part(5.6, 6, 4.8, 4));
/** Its own size back: a window, and the larger one it was. */
export const TILE_RESTORE = svg(
  `<rect x="2" y="5.4" width="8.6" height="7.6" rx="1.4" stroke="#000" stroke-width="1.4" fill="none"/>${stroke("M5.4 3h7.2a1.4 1.4 0 0 1 1.4 1.4v5.8")}`,
);
/** Full screen: four corners pushed out. */
export const FULL_SCREEN = svg(
  stroke("M2.6 6V3.4a.8.8 0 0 1 .8-.8H6M10 2.6h2.6a.8.8 0 0 1 .8.8V6M13.4 10v2.6a.8.8 0 0 1-.8.8H10M6 13.4H3.4a.8.8 0 0 1-.8-.8V10"),
);

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
  capture: CAMERA,
  screenshot: CAPTURE_GLYPHS.screen,
  "screenshot-area": CAPTURE_GLYPHS.area,
};

/** The glyphs of Dashi's commands from its other sources (the clipboard, windows, tools), by address. */
export const ADDRESS_GLYPHS: Readonly<Record<string, string>> = {
  "dashi://clipboard/history": CLIPBOARD,
  "dashi://clipboard/snippets": SNIPPET,
  "dashi://clipboard/clear": CLEAR_CLIPBOARD,
  "dashi://window/arrange/left": TILE_LEFT,
  "dashi://window/arrange/right": TILE_RIGHT,
  "dashi://window/arrange/up": TILE_UP,
  "dashi://window/arrange/down": TILE_DOWN,
  "dashi://window/arrange/fill": TILE_FILL,
  "dashi://window/arrange/center": TILE_CENTER,
  "dashi://window/arrange/restore": TILE_RESTORE,
  "dashi://window/full-screen": FULL_SCREEN,
  "dashi://tool/lock-screen": LOCK,
  "dashi://tool/clear-notifications": CLEAR_NOTIFICATIONS,
};

/** Sources whose commands are Dashi's own, drawn by address. */
const OWN_SOURCES = new Set(["clipboard", "windows", "tools"]);

/** The glyph of one of Dashi's own commands; undefined for an app's, an applet's, a script's, or one without. */
export function commandGlyph(action: { source: string; address: string }): string | undefined {
  if (action.source === "dashi") return COMMAND_GLYPHS[action.address.split("/").pop() ?? ""];
  return OWN_SOURCES.has(action.source) ? ADDRESS_GLYPHS[action.address] : undefined;
}
