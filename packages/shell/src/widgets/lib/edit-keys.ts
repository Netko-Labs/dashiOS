/**
 * Editing from the keyboard (round five, #26, written in the editing
 * header): Tab and ⇧Tab go from widget to widget, ⌥ arrows move the one
 * chosen, ⌥⇧ arrows step its size through the sizes it offers, Delete takes
 * it away, Esc or Return is Done. Pure: the edit view applies the answer.
 */

import { SIZE_ORDER } from "../layout.ts";
import type { Placement, WidgetSize } from "../types.ts";

export interface EditKey {
  key: string;
  alt: boolean;
  shift: boolean;
}

export type EditAnswer =
  | { do: "select"; id: string | null }
  | { do: "move"; id: string; to: number }
  | { do: "resize"; id: string; size: WidgetSize }
  | { do: "remove"; id: string }
  | { do: "done" }
  | { do: "nothing" };

/** The next size in `offered` from `size`, `step` places along the order (−1 smaller, +1 bigger); the same at either end. */
export function stepSize(offered: readonly WidgetSize[], size: WidgetSize, step: -1 | 1): WidgetSize {
  const sorted = [...offered].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b));
  const at = sorted.indexOf(size);
  return sorted[Math.max(0, Math.min(sorted.length - 1, (at < 0 ? 0 : at) + step))] ?? size;
}

export function editKey(
  placements: readonly Placement[],
  selected: string | null,
  key: EditKey,
  sizesOf: (placement: Placement) => readonly WidgetSize[],
): EditAnswer {
  if (key.key === "Escape" || key.key === "Enter" || key.key === "Return") return { do: "done" };
  const at = placements.findIndex((each) => each.id === selected);
  const chosen = placements[at];
  if (key.key === "Tab") {
    if (placements.length === 0) return { do: "nothing" };
    const next = at < 0 ? (key.shift ? placements.length - 1 : 0) : (at + (key.shift ? -1 : 1) + placements.length) % placements.length;
    return { do: "select", id: placements[next]?.id ?? null };
  }
  if (!chosen) return { do: "nothing" };
  if (key.key === "Delete" || key.key === "Backspace") return { do: "remove", id: chosen.id };
  const arrow = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[key.key] as -1 | 1 | undefined;
  if (arrow === undefined || !key.alt) return { do: "nothing" };
  if (key.shift) return { do: "resize", id: chosen.id, size: stepSize(sizesOf(chosen), chosen.size, arrow) };
  return { do: "move", id: chosen.id, to: Math.max(0, Math.min(placements.length - 1, at + arrow)) };
}

/** Where a widget dragged to `y` (in the column) lands in the order: before the first whose middle is below it. */
export function dropIndex(boxes: readonly { id: string; y: number; height: number }[], dragged: string, y: number): number {
  const others = boxes.filter((box) => box.id !== dragged);
  const at = others.findIndex((box) => y < box.y + box.height / 2);
  return at < 0 ? others.length : at;
}

/** The edge handle's press: the next bigger size, and from the biggest back to the smallest. */
export function cycleSize(offered: readonly WidgetSize[], size: WidgetSize): WidgetSize {
  const bigger = stepSize(offered, size, 1);
  if (bigger !== size) return bigger;
  return [...offered].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b))[0] ?? size;
}
