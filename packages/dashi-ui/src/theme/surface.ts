/**
 * The grounds Dashi's windows paint on: System Settings and the first-party
 * apps. A window is opaque (it has nothing to see through), so these are solid
 * colors chosen from the palette in use; the shell's own glass (menus, the
 * Dock) paints from the palette directly.
 */

import { useDark } from "./appearance.ts";
import { TRUE_BLACK } from "./palette.ts";

export interface Surface {
  window: string;
  sidebar: string;
  /** A grouped card of rows. */
  card: string;
  /** A text field, or a list sunk into a card. */
  field: string;
  /** Every other row of a table (macOS's alternating rows). */
  stripe: string;
  /** Behind media: a picture or a document's pages in a viewer (Preview), a shade off the window so pages stand out. */
  canvas: string;
}

export const LIGHT_SURFACE: Surface = { window: "#f5f5f7", sidebar: "#e8e8ec", card: "#ffffff", field: "#f0f0f3", stripe: "#f4f4f6", canvas: "#e4e4e8" };
/**
 * True black: the window is #000000, and the sidebar, a field and a stripe
 * are the first lift (#0b0b0d), a card the second (#141417), so a field in a
 * card is sunk below it. Media sits on the black itself: there is nothing
 * darker for `canvas` to be.
 */
export const DARK_SURFACE: Surface = {
  window: TRUE_BLACK.ground,
  sidebar: TRUE_BLACK.lift,
  card: TRUE_BLACK.raised,
  field: TRUE_BLACK.lift,
  stripe: TRUE_BLACK.lift,
  canvas: TRUE_BLACK.ground,
};

export function useSurface(): Surface {
  return useDark() ? DARK_SURFACE : LIGHT_SURFACE;
}
