import type { Placement } from "@dashi/applet";
import { SPACE } from "@dashi/ui";
/**
 * Where an applet's popover goes: under the menu bar, centered on the item
 * that was clicked, kept inside the screen. A popover asked for wider or
 * taller than the screen allows gets the room there is (the applet draws to
 * the size it is given). All in the screen's own points: layer-shell
 * margins are per screen.
 *
 * The shell frames it (design.html LA-4, D784): regular glass, radius 12,
 * 14 round the applet's tree, drawn on the catcher's surface under the
 * applet's own (applets/start.tsx). The frame is what is kept inside the
 * screen; the applet is given the room inside it, the size it asked for.
 */

/** Room kept between a popover and the screen's left, right, and bottom edges. */
export const EDGE_MARGIN = 8;
/** Between the menu bar's bottom edge and the popover. */
export const BAR_GAP = 4;
/** The shell's frame round an applet's popover: regular glass, its radius and its padding (LA-4). */
export const POPOVER_FRAME = { radius: 12, padding: SPACE.button } as const;

export interface PopoverScreen {
  /** The output name; null when the shell can't tell (one screen, no compositor). */
  name: string | null;
  width: number;
  height: number;
  /** The menu bar's height on that screen: popovers start under it. */
  barHeight: number;
}

/**
 * `anchorX` is the item's center (screen points); null puts the popover at the right, under the status area.
 * What the applet draws in: the frame, placed and kept inside the screen, less its padding.
 */
export function placePopover(size: { width: number; height: number }, anchorX: number | null, screen: PopoverScreen): Placement {
  const pad = POPOVER_FRAME.padding;
  const top = screen.barHeight + BAR_GAP;
  const width = Math.max(1, Math.min(Math.round(size.width) + 2 * pad, screen.width - 2 * EDGE_MARGIN));
  const height = Math.max(1, Math.min(Math.round(size.height) + 2 * pad, screen.height - top - EDGE_MARGIN));
  const right = screen.width - EDGE_MARGIN - width;
  const wanted = anchorX === null ? right : Math.round(anchorX - width / 2);
  const x = Math.max(EDGE_MARGIN, Math.min(wanted, right));
  return { x: x + pad, y: top + pad, width: Math.max(1, width - 2 * pad), height: Math.max(1, height - 2 * pad), output: screen.name };
}

/** The frame round a placed popover, in the same points. */
export function popoverFrame(placement: Placement): { x: number; y: number; width: number; height: number } {
  const pad = POPOVER_FRAME.padding;
  return { x: placement.x - pad, y: placement.y - pad, width: placement.width + 2 * pad, height: placement.height + 2 * pad };
}
