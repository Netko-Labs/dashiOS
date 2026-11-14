/**
 * The bottom centre is a stack (pill-v2 README, "Where it sits"): the Dock,
 * the capsule or the card, then the volume indicator, drawn small. This says
 * how high the capsule or card reaches, so the indicator sits above it
 * (system/lib/osd-panel.tsx) and never on it.
 */

import { type Cell, cell } from "../shared/pill/index.ts";

/** What is up at the bottom centre: its top, from the screen's bottom edge, and its screen. Null when nothing is. */
export interface BottomStack {
  top: number;
  output: string | undefined;
}

export const bottomStack: Cell<BottomStack | null> = cell<BottomStack | null>(null);
