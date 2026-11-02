/**
 * The arrangement view: the screens drawn to scale, side by side as they sit
 * on the desk. Drag one to move it; it snaps its edge against another's and
 * never overlaps (display-config/layout.ts), and the compositor keeps what
 * was dropped. The main display carries a thin bar on top, as the menu bar.
 */

import { type Bounds, Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { beginDrag, type Box, type Drag, dropSpot, fitView, moveDrag, type Spot } from "../../display-config/layout.ts";
import { type Monitor, monitorLabel } from "../../display-config/monitors.ts";
import { useColors } from "@dashi/ui";
import { useSurface } from "../ui.tsx";

export const ARRANGEMENT_HEIGHT = 190;
const MARGIN = 14;

/** The screens that are on and say where they are, as boxes in points. */
export function boxesOf(monitors: readonly Monitor[]): Box[] {
  return monitors.flatMap((monitor) =>
    monitor.enabled && monitor.frame
      ? [{ name: monitor.name, x: monitor.frame.x, y: monitor.frame.y, width: monitor.frame.width, height: monitor.frame.height }]
      : [],
  );
}

/** The view's size: the pane's content width at the Settings window's opening size (760 less the sidebar and padding). */
export const ARRANGEMENT_WIDTH = 512;

export function ArrangementView({ monitors, onMove }: { monitors: readonly Monitor[]; onMove: (name: string, spot: Spot) => void }) {
  const colors = useColors();
  const surface = useSurface();
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
        style={{
          width: ARRANGEMENT_WIDTH,
          height: ARRANGEMENT_HEIGHT,
          flexShrink: 0,
          position: "relative",
          overflow: "hidden",
          borderRadius: 8,
          backgroundColor: surface.field,
        }}
      >
        {boxes.map((box) => {
          const shown = place(box);
          const monitor = monitors.find((candidate) => candidate.name === box.name);
          const lifted = drag?.name === box.name;
          return (
            <View
              key={box.name}
              testID={`arrangement:${box.name}`}
              style={{
                position: "absolute",
                left: view.originX + shown.x * view.scale,
                top: view.originY + shown.y * view.scale,
                width: shown.width * view.scale,
                height: shown.height * view.scale,
                borderRadius: 4,
                borderWidth: lifted ? 2 : 1,
                borderColor: lifted ? colors.selection : colors.separator,
                backgroundColor: surface.card,
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {monitor?.primary && (
                <View style={{ position: "absolute", left: 0, top: 0, width: shown.width * view.scale, height: 5, backgroundColor: colors.selection }} />
              )}
              <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.text }}>{monitor ? monitorLabel(monitor) : box.name}</Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>{box.name}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
