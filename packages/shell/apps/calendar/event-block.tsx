/**
 * A timed event on the day and week grid: a block at its time, its title and
 * start, and its place when there is room. Pressing it shows its popover;
 * dragging it moves it, and dragging its bottom edge (`RESIZE_EDGE` tall)
 * stretches it. Tab reaches it, and Space or Return shows the popover. While
 * it is dragged it stays faintly where it was.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, type PointerInfo, Text, View } from "@mirinjs/metal";
import type { ClockPrefs } from "../../src/clock.ts";
import { tint } from "./colors.ts";
import type { DragKind } from "./drag.ts";
import { clock, titleOf } from "./format.ts";
import { type Placed, yAtMinutes } from "./layout.ts";
import type { Occurrence } from "./types.ts";

/** The strip at a block's foot that stretches it. */
export const RESIZE_EDGE = 6;

export const occurrenceKey = (occurrence: Pick<Occurrence, "calendarId" | "event" | "start">): string =>
  `${occurrence.calendarId}:${occurrence.event.uid}:${occurrence.start}`;

export interface BlockProps {
  placed: Placed;
  color: string;
  /** The column's width (0 until it is known). */
  width: number;
  prefs: ClockPrefs;
  selected: boolean;
  /** It is being dragged: the drag shows where it goes, and it stays faintly here. */
  dragged: boolean;
  /** It ends in this column, so its bottom edge stretches it. */
  resizable: boolean;
  onPointer: (kind: DragKind, info: PointerInfo) => void;
  onPress: (bounds: Bounds | undefined) => void;
}

export function EventBlock({ placed, color, width, prefs, selected, dragged, resizable, onPointer, onPress }: BlockProps) {
  const colors = useColors();
  const { occurrence } = placed;
  const { event } = occurrence;
  const top = yAtMinutes(placed.top);
  const height = Math.max(yAtMinutes(placed.bottom - placed.top) - 1, 16);
  const share = width > 0 ? (width - 6) / placed.columns : 0;
  const compact = height < 34;
  return (
    <View
      testID={`event:${occurrenceKey(occurrence)}`}
      focusable
      accessibilityRole="button"
      accessibilityLabel={`${titleOf(event)}, ${clock(occurrence.start, prefs)}`}
      onPress={(info) => onPress(info.bounds)}
      onPointer={(info) => onPointer("move", info)}
      style={{
        position: "absolute",
        top,
        height,
        left: width > 0 ? 2 + placed.column * share : 2,
        width: width > 0 ? share - 2 : "100%",
        flexDirection: compact ? "row" : "column",
        gap: compact ? 5 : 1,
        alignItems: compact ? "center" : "flex-start",
        overflow: "hidden",
        paddingHorizontal: 6,
        paddingVertical: compact ? 0 : 3,
        borderRadius: 5,
        borderLeftWidth: 3,
        borderColor: color,
        backgroundColor: tint(color, selected ? 0.55 : 0.26),
        hoverBackgroundColor: tint(color, selected ? 0.6 : 0.4),
        opacity: dragged ? 0.35 : 1,
        focusRingColor: colors.focusRing,
      }}
    >
      <View style={compact ? { flex: 1, minWidth: 0 } : { width: "100%" }}>
        <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "semibold", color: colors.text }}>
          {titleOf(event)}
        </Text>
      </View>
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 10, color: colors.textMuted }}>
          {clock(occurrence.start, prefs)}
        </Text>
      </View>
      {!compact && event.location !== "" && (
        <Text numberOfLines={1} style={{ fontSize: 10, color: colors.textMuted }}>
          {event.location}
        </Text>
      )}
      {resizable && (
        <View
          testID={`resize:${occurrenceKey(occurrence)}`}
          onPointer={(info) => onPointer("resize", info)}
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: RESIZE_EDGE }}
        />
      )}
    </View>
  );
}

/** Where a drag would put an event (or a new one): the same block, solid, with its new times. */
export function GhostBlock({ top, bottom, color, title, times }: { top: number; bottom: number; color: string; title: string; times: string }) {
  const colors = useColors();
  return (
    <View
      testID="ghost"
      style={{
        position: "absolute",
        top: yAtMinutes(top),
        height: Math.max(yAtMinutes(bottom - top) - 1, 14),
        left: 2,
        right: 4,
        flexDirection: "column",
        gap: 1,
        overflow: "hidden",
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 5,
        borderLeftWidth: 3,
        borderColor: color,
        backgroundColor: tint(color, 0.5),
        shadow: "md",
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "semibold", color: colors.text }}>
        {title}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 10, color: colors.textMuted }}>
        {times}
      </Text>
    </View>
  );
}
