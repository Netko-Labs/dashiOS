/**
 * Where the notice goes that names the app holding a log out, restart, or
 * shut down (closing-apps.ts): never over that app's own question. An app's
 * sheet hangs from the top of its window, so the notice floats at the foot
 * of the screen, above the Dock, as a window's notice floats at the foot of
 * its content (design.html VS-3, PA-4); it takes no row of its own, so the
 * menu bar stays the one chrome row. Only when the window's top is so low
 * that its sheet would reach the foot does the notice go under the menu bar
 * instead, where that window can't be. Pure: the shell asks the compositor
 * for the window's frame and the screens.
 */

import { type Output, type Rect, screenFor } from "../layout.ts";

/** The notice: its card at most this wide and tall (two lines of text), and the room its shadow takes around it on the surface. */
export const HOLDING = { width: 560, height: 48, shadow: 28 } as const;

/** The surface the card is drawn on: the card and its shadow's room. */
export const HOLDING_SURFACE = { width: HOLDING.width + 2 * HOLDING.shadow, height: HOLDING.height + 2 * HOLDING.shadow } as const;

/**
 * How far below a window's top edge its sheet can reach: the unified toolbar
 * (38), the sheet's 8 below it, and the tallest sheet an app asks with.
 */
export const SHEET_REACH = 300;

export interface HoldingPlace {
  /** The screen edge the notice floats at. */
  edge: "top" | "bottom";
  /** The screen it goes on: the one holding the window; absent when not known. */
  output?: string;
}

/** Where the notice goes for a window with this outer frame (null: not on screen), on these screens. */
export function holdingPlace(frame: Rect | null, outputs: readonly Output[]): HoldingPlace {
  const screen = frame ? screenFor(frame, outputs) : null;
  if (!frame || !screen) return { edge: "bottom" };
  // The band the notice takes at the foot of the usable area, its shadow's room included.
  const footTop = screen.usable.y + screen.usable.height - HOLDING_SURFACE.height;
  const sheetBottom = frame.y + SHEET_REACH;
  return { edge: sheetBottom <= footTop ? "bottom" : "top", ...(screen.name ? { output: screen.name } : {}) };
}
