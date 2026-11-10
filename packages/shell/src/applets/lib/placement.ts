import type { Placement } from "@dashi/applet";
/**
 * Where an applet's popover goes: under the menu bar, centered on the item
 * that was clicked, kept inside the screen. A popover asked for wider or
 * taller than the screen allows gets the room there is (the applet draws to
 * the size it is given). All in the screen's own points: layer-shell
 * margins are per screen.
 */

/** Room kept between a popover and the screen's left, right, and bottom edges. */
export const EDGE_MARGIN = 8;
/** Between the menu bar's bottom edge and the popover. */
export const BAR_GAP = 4;

export interface PopoverScreen {
  /** The output name; null when the shell can't tell (one screen, no compositor). */
  name: string | null;
  width: number;
  height: number;
  /** The menu bar's height on that screen: popovers start under it. */
  barHeight: number;
}

/** `anchorX` is the item's center (screen points); null puts the popover at the right, under the status area. */
export function placePopover(size: { width: number; height: number }, anchorX: number | null, screen: PopoverScreen): Placement {
  const top = screen.barHeight + BAR_GAP;
  const width = Math.max(1, Math.min(Math.round(size.width), screen.width - 2 * EDGE_MARGIN));
  const height = Math.max(1, Math.min(Math.round(size.height), screen.height - top - EDGE_MARGIN));
  const right = screen.width - EDGE_MARGIN - width;
  const wanted = anchorX === null ? right : Math.round(anchorX - width / 2);
  const x = Math.max(EDGE_MARGIN, Math.min(wanted, right));
  return { x, y: top, width, height, output: screen.name };
}
