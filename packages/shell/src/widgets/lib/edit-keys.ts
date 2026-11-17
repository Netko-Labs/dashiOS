/**
 * Editing from the keyboard (round five, #26, written in the editing
 * header): Tab and ⇧Tab go from widget to widget, ⌥ arrows move the one
 * chosen, ⌥⇧ arrows step its size through the sizes it offers, Delete takes
 * it away, Esc or Return is Done. In the gallery ↑ ↓ go through the list,
 * ← → through the chosen widget's sizes, Return adds that size, Esc closes
 * it. Pure: the edit view applies the answer.
 */

import { SIZE_ORDER } from "../layout.ts";
import type { Placement, WidgetSize } from "../types.ts";

export interface EditKey {
  key: string;
  alt: boolean;
  shift: boolean;
}

/**
 * The Metal host names keys as GPUI does ("escape", "enter", "tab", "up"),
 * not as a browser does; the edit keys are matched by the browser's names,
 * so a key from the host goes through here first.
 */
const HOST_NAMES: Readonly<Record<string, string>> = {
  escape: "Escape",
  enter: "Enter",
  tab: "Tab",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  delete: "Delete",
  backspace: "Backspace",
};

export function hostKey(event: { key: string; alt: boolean; shift: boolean }): EditKey {
  return { key: HOST_NAMES[event.key] ?? event.key, alt: event.alt, shift: event.shift };
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

export type GalleryAnswer =
  | { do: "choose"; kind: string; sizeAt: number }
  | { do: "size"; sizeAt: number }
  | { do: "add"; kind: string; size: WidgetSize }
  | { do: "close" }
  | { do: "nothing" };

/** A key while the gallery is open: `kinds` in the list's order, `sizes` what the chosen one offers, in the previews' order. */
export function galleryKey(kinds: readonly string[], chosen: string | undefined, sizes: readonly WidgetSize[], sizeAt: number, key: EditKey): GalleryAnswer {
  if (key.key === "Escape") return { do: "close" };
  // ⌥ arrows still move and resize in the column beside it.
  if (key.alt) return { do: "nothing" };
  const at = Math.max(0, kinds.indexOf(chosen ?? ""));
  if (key.key === "ArrowUp" || key.key === "ArrowDown") {
    const next = Math.max(0, Math.min(kinds.length - 1, at + (key.key === "ArrowUp" ? -1 : 1)));
    const kind = kinds[next];
    return kind === undefined ? { do: "nothing" } : { do: "choose", kind, sizeAt: 0 };
  }
  if (key.key === "ArrowLeft" || key.key === "ArrowRight") {
    if (sizes.length === 0) return { do: "nothing" };
    return { do: "size", sizeAt: Math.max(0, Math.min(sizes.length - 1, sizeAt + (key.key === "ArrowLeft" ? -1 : 1))) };
  }
  if (key.key === "Enter" || key.key === "Return") {
    const size = sizes[Math.min(sizeAt, sizes.length - 1)];
    return chosen !== undefined && size !== undefined ? { do: "add", kind: chosen, size } : { do: "nothing" };
  }
  return { do: "nothing" };
}
