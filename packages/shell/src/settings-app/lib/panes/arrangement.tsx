/**
 * The arrangement view: the screens drawn to scale, side by side as they sit
 * on the desk. Drag one to move it; it snaps its edge against another's and
 * never overlaps (display-config/layout.ts), and the compositor keeps what
 * was dropped. The main display carries a thin bar on top, as the menu bar.
 */

import { RADIUS, TYPE, useControlColors, WEIGHT } from "@dashi/ui";
import { type Bounds, Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { type Box, beginDrag, type Drag, dropSpot, type View as FitView, fitView, moveDrag, type Spot } from "../../../display-config/layout.ts";
import type { Monitor } from "../../../display-config/monitors.ts";
import { displayName } from "../heroes.ts";

export const ARRANGEMENT_HEIGHT = 190;
const MARGIN = 14;
/** A screen's box: its edge (3 while lifted), the main one's menu bar on top. */
const BOX_EDGE = { rest: 2, lifted: 3, bar: 5 } as const;

/** The screens that are on and say where they are, as boxes in points. */
export function boxesOf(monitors: readonly Monitor[]): Box[] {
  return monitors.flatMap((monitor) =>
    monitor.enabled && monitor.frame
      ? [{ name: monitor.name, x: monitor.frame.x, y: monitor.frame.y, width: monitor.frame.width, height: monitor.frame.height }]
      : [],
  );
}

/** The view's size: inside Displays' hero at the Settings window's opening size. */
export const ARRANGEMENT_WIDTH = 560;

/** One screen in the arrangement, drawn to scale at where it sits (or where it is being dragged to). */
function ArrangementBox({
  box,
  monitor,
  monitors,
  view,
  lifted,
}: {
  box: Box;
  monitor: Monitor | undefined;
  monitors: readonly Monitor[];
  view: FitView;
  lifted: boolean;
}) {
  const colors = useControlColors();
  return (
    <View
      testID={`arrangement:${box.name}`}
      style={{
        position: "absolute",
        left: view.originX + box.x * view.scale,
        top: view.originY + box.y * view.scale,
        width: box.width * view.scale,
        height: box.height * view.scale,
        borderRadius: RADIUS.control,
        borderWidth: lifted ? BOX_EDGE.lifted : BOX_EDGE.rest,
        borderColor: lifted ? colors.text : colors.muted,
        backgroundColor: colors.surface,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {monitor?.primary && (
        <View style={{ position: "absolute", left: 0, top: 0, width: box.width * view.scale, height: BOX_EDGE.bar, backgroundColor: colors.text }} />
      )}
      {/* Its plain name only: a connector ("Virtual-1") is no one's word for a screen (VO-11). */}
      <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.offInk }}>
        {monitor ? displayName(monitor, monitors) : "Display"}
      </Text>
    </View>
  );
}

const AREA = {
  width: ARRANGEMENT_WIDTH,
  height: ARRANGEMENT_HEIGHT,
  flexShrink: 0,
  position: "relative",
  overflow: "hidden",
  borderRadius: RADIUS.sheet,
} as const;

export function ArrangementView({ monitors, onMove }: { monitors: readonly Monitor[]; onMove: (name: string, spot: Spot) => void }) {
  const colors = useControlColors();
  const boxes = boxesOf(monitors);
  const size = { width: ARRANGEMENT_WIDTH, height: ARRANGEMENT_HEIGHT };
  // Pointer events carry the view's bounds; the last layout stands in for one that does not.
  const laid = useRef<Bounds | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragging = useRef<Drag | null>(null);
  /** Where a drop was put, until the compositor's layout arrives. */
  const [dropped, setDropped] = useState<{ name: string; spot: Spot } | null>(null);
  // A new layout is the truth again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the layout changing is the trigger
  useEffect(() => setDropped(null), [monitors]);

  if (boxes.length === 0) return null;
  const view = fitView(boxes, size.width, size.height, MARGIN);
  const place = (box: Box): Box => {
    if (drag?.name === box.name) return { ...box, x: drag.spot.x, y: drag.spot.y };
    if (dropped?.name === box.name) return { ...box, x: dropped.spot.x, y: dropped.spot.y };
    return box;
  };

  const pixel = (event: { x: number; y: number; bounds?: Bounds }): Spot | null => {
    const bounds = event.bounds ?? laid.current;
    return bounds ? { x: event.x - bounds.x, y: event.y - bounds.y } : null;
  };

  // Wrapped: the host reports a view's bounds from its parent's painting, which a page's scroll list does not do.
  return (
    <View testID="display-arrangement-frame" style={{ flexShrink: 0, flexDirection: "column" }}>
      <View
        testID="display-arrangement"
        onLayout={(bounds) => {
          laid.current = bounds;
        }}
        onPointer={(event) => {
          const at = pixel(event);
          if (!at) return;
          if (event.phase === "down") {
            const started = beginDrag(boxes, view, at);
            dragging.current = started;
            setDrag(started);
          } else if (dragging.current) {
            const next = moveDrag(dragging.current, boxes, view, at);
            dragging.current = next;
            if (event.phase === "move") {
              setDrag(next);
            } else {
              const spot = dropSpot(next);
              dragging.current = null;
              setDrag(null);
              if (spot) {
                setDropped({ name: next.name, spot });
                onMove(next.name, spot);
              }
            }
          }
        }}
        style={{ ...AREA, backgroundColor: colors.line }}
      >
        {boxes.map((box) => (
          <ArrangementBox
            key={box.name}
            box={place(box)}
            monitor={monitors.find((candidate) => candidate.name === box.name)}
            monitors={monitors}
            view={view}
            lifted={drag?.name === box.name}
          />
        ))}
      </View>
    </View>
  );
}
