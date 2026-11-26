/**
 * Magnification (DK-6, decisions.md D800): the icon under the pointer grows
 * to `GLASS.dock.magnify.peak` and its two neighbours to `.neighbour`,
 * lifted by up to `.lift`, and the row widens with them. Metal tells a view
 * only that the pointer is over it (`onHoverChange`), not where, so the
 * growth goes by icon, as frost-objects board 05 draws it: one peak, two
 * neighbours. The icon under the pointer keeps its centre where it was (its
 * neighbours grow alike on both sides), so a press lands on the icon drawn
 * under the pointer. Off by setting, under Reduce Motion (MO-3), and while
 * a drag or a menu is open.
 */

import { GLASS } from "@dashi/ui";

const { peak, neighbour, lift } = GLASS.dock.magnify;

/** How one icon is drawn: its scale and how far it rises above its place. */
export interface Magnified {
  scale: number;
  lift: number;
}

export const AT_REST: Magnified = { scale: 1, lift: 0 };

/** Icon `index`'s look while the icon at `hovered` (null: none) is under the pointer. */
export function magnified(index: number, hovered: number | null): Magnified {
  if (hovered === null) return AT_REST;
  const away = Math.abs(index - hovered);
  if (away === 0) return { scale: peak, lift };
  if (away === 1) return { scale: neighbour, lift: Math.round((lift * (neighbour - 1)) / (peak - 1)) };
  return AT_REST;
}

/** The size of an icon `base` points at rest, magnified: whole points, so the row never lands between pixels. */
export const magnifiedSize = (base: number, look: Magnified): number => Math.round(base * look.scale);

/** How much taller than at rest the tallest magnified icon reaches, lift included: the room the Dock's surface keeps above its panel. */
export function magnifyHeadroom(base: number): number {
  return magnifiedSize(base, { scale: peak, lift }) - base + lift;
}
