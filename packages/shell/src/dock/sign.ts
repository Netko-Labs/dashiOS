/**
 * What the Dock and the capsule tell each other (pill-v2 README, "A real
 * question, and a fake"): where the Dock is, so the capsule sits clear of it
 * and a card stands on it; and that a card asks, so the Dock comes out, dims
 * and wears the amber rim for as long as it does. One Dock, so one of these.
 */

import { type Cell, cell } from "../shared/pill/index.ts";

/** The Dock on screen, as the capsule's place needs it. */
export interface DockPlace {
  /** On screen now (an autohidden Dock that is away is not). */
  shown: boolean;
  style: "dock" | "taskbar";
  /** The panel in its surface, which spans the screen: where the Dock's row is taken. Null until it is laid out, and for the taskbar. */
  panel: { x: number; width: number } | null;
  output: string | undefined;
}

export const dockSign: { place: Cell<DockPlace | null>; asking: Cell<boolean> } = { place: cell<DockPlace | null>(null), asking: cell(false) };

/** The rim a Dock wears while a card asks: amber, this wide. */
export const ASK_RIM = { color: "#f0b93c", width: 3, dim: 0.38 } as const;
