/**
 * One press-move-release on the grid at a time (Metal's `onPointer`: the
 * view pressed hears every move and the release, wherever the pointer goes).
 * The view that was pressed calls `begin`, then `track` with each later
 * phase; the window shows `preview` meanwhile, and on the release learns
 * whether it was a drag (`onDrop`) or a click (`onClick`). Esc calls `cancel`:
 * what is left of that press is then ignored. A press an event's `onPress`
 * hears just after a drag is not a click (`justDragged`).
 */

import type { PointerInfo } from "@mirinjs/metal";
import { useMemo, useRef, useState } from "react";
import { type DragStart, type Geometry, isDrag, type Preview, previewOf } from "./drag.ts";

export interface Drag extends DragStart {
  moved: boolean;
  preview: Preview | null;
}

export interface Gesture {
  /** The drag under way, once it has moved. */
  drag: Drag | null;
  begin(start: DragStart, geometry: Geometry): void;
  track(info: PointerInfo): void;
  cancel(): boolean;
  justDragged(): boolean;
}

/** How long after a drag's release a press on the same view is still part of it. */
const PRESS_AFTER_DRAG_MS = 400;

export function useGesture(handlers: { onDrop: (drag: Drag) => void; onClick: (start: DragStart) => void }): Gesture {
  const current = useRef<{ drag: Drag; geometry: Geometry } | null>(null);
  const draggedAt = useRef(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useRef(handlers);
  latest.current = handlers;

  const methods = useMemo<Omit<Gesture, "drag">>(
    () => ({
      begin(start, geometry) {
        current.current = { drag: { ...start, moved: false, preview: null }, geometry };
      },
      track(info) {
        const held = current.current;
        if (!held || info.phase === "down") return;
        const dx = info.x - held.drag.x;
        const dy = info.y - held.drag.y;
        if (info.phase === "move") {
          if (!held.drag.moved && !isDrag(dx, dy)) return;
          held.drag = { ...held.drag, moved: true, preview: previewOf(held.drag, dx, dy, held.geometry, info.x, info.y) };
          draggedAt.current = Date.now();
          setDrag(held.drag);
          return;
        }
        current.current = null;
        setDrag(null);
        if (held.drag.moved) {
          draggedAt.current = Date.now();
          latest.current.onDrop(held.drag);
        } else latest.current.onClick(held.drag);
      },
      cancel() {
        if (!current.current) return false;
        const moved = current.current.drag.moved;
        current.current = null;
        setDrag(null);
        if (moved) draggedAt.current = Date.now();
        return true;
      },
      justDragged() {
        return current.current?.drag.moved === true || Date.now() - draggedAt.current < PRESS_AFTER_DRAG_MS;
      },
    }),
    [],
  );
  return { ...methods, drag };
}
