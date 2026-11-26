/**
 * The ink ring of widget edit mode (frost-objects board 22, D792): round the card being edited and the
 * gallery's picked size, `width` of ink, `out` outside the card, its corner the card's plus that. Ink,
 * never the accent: editing isn't choosing (H23); purple stays the keyboard's (KB-2).
 */

import { RADIUS } from "@dashi/ui";

/** How far outside the card the ring stands. */
const OUT = 3;

export const EDIT_RING = {
  width: 2,
  out: OUT,
  /** The ring's corner round a card (one row: `row`). */
  radius: (row: boolean): number => (row ? RADIUS.inkCardRow : RADIUS.inkCard) + OUT,
} as const;
