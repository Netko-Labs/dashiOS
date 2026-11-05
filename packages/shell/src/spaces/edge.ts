/**
 * Pushing a window against a screen's side to carry it to the next Desktop:
 * the shell's policy for the compositor's `edge-hold` (comp/src/wm/edge_hold.rs).
 * Only the left and right edges, and only where no screen is beyond (there
 * the window just goes over to that screen); never while a tile preview
 * shows (the person rested there to tile, not to move on). Held on, it goes
 * on: one Desktop per hold, up to the last one (no wrapping, as the keys).
 * Pure; start.tsx carries it out with `space-switch`, and the compositor
 * takes the held window along.
 */

import type { ScreenEdge } from "../compositor.ts";
import type { Output } from "../layout.ts";
import type { SpacesState } from "./model.ts";

export interface EdgeHold {
  edge: ScreenEdge;
  output: string;
  preview: boolean;
}

/** Whether a screen other than `screen` lies beyond its `edge` (touching it, overlapping it along that edge). */
export function screenBeyond(screen: Output, edge: "left" | "right", outputs: readonly Output[]): boolean {
  const { frame } = screen;
  return outputs.some(({ name, frame: other }) => {
    if (name === screen.name) return false;
    const besides = other.y < frame.y + frame.height && other.y + other.height > frame.y;
    const touches = edge === "left" ? other.x + other.width === frame.x : other.x === frame.x + frame.width;
    return besides && touches;
  });
}

/** The Desktop a hold carries the window to, or null when this hold does nothing. */
export function edgeHoldTarget(hold: EdgeHold, outputs: readonly Output[], spaces: SpacesState): number | null {
  if (hold.preview) return null;
  if (hold.edge !== "left" && hold.edge !== "right") return null;
  const screen = outputs.find((output) => output.name === hold.output);
  if (!screen || screenBeyond(screen, hold.edge, outputs)) return null;
  const target = spaces.current + (hold.edge === "left" ? -1 : 1);
  return target >= 0 && target < spaces.count ? target : null;
}
