/**
 * A timed event on the day and week grid: a block at its time, its title and
 * start, and its place when there is room. Pressing it shows its popover;
 * dragging it moves it, and dragging its bottom edge (`RESIZE_EDGE` tall)
 * stretches it. Tab reaches it, and Space or Return shows the popover. While
 * it is dragged it stays faintly where it was.
 */

import { useColors, useSurface } from "@dashi/ui";
import { type Bounds, type PointerInfo, Text, View } from "@mirinjs/metal";
import type { Occurrence } from "../../../../src/shared/calendar/types.ts";
import type { ClockPrefs } from "../../../../src/shared/time/index.ts";
import { over, tint } from "../colors.ts";
import { clock, titleOf } from "../format.ts";
import { type Placed, yAtMinutes } from "../layout.ts";
import type { DragKind } from "./drag.ts";

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

/** A one-line block shows its start after the title only from this width; the title comes first. */
export const TIME_BESIDE_FROM = 120;
/** A taller block shows its start on its own line only from this width. */
export const TIME_UNDER_FROM = 60;

/** What a block `width` wide and `height` tall shows besides its title. */
export function blockParts(width: number, height: number): { oneLine: boolean; time: boolean; place: boolean } {
  const oneLine = height < 34;
  const known = width > 0;
  return {
    oneLine,
    time: !known || width >= (oneLine ? TIME_BESIDE_FROM : TIME_UNDER_FROM),
    place: !oneLine && height >= 46 && (!known || width >= TIME_UNDER_FROM),
  };
}

export function EventBlock({ placed, color, width, prefs, selected, dragged, resizable, onPointer, onPress }: BlockProps) {
  const colors = useColors();
  const surface = useSurface();
  const { occurrence } = placed;
  const { event } = occurrence;
  const top = yAtMinutes(placed.top);
  const height = Math.max(yAtMinutes(placed.bottom - placed.top) - 1, 16);
  const room = width > 0 ? width - 6 : 0;
  const blockWidth = room > 0 ? (placed.right - placed.left) * room - 2 : 0;
  const parts = blockParts(blockWidth, height);
  const compact = parts.oneLine;
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
        left: room > 0 ? 2 + placed.left * room : 2,
        width: room > 0 ? blockWidth : "100%",
        flexDirection: compact ? "row" : "column",
        gap: compact ? 6 : 1,
        alignItems: compact ? "center" : "flex-start",
        overflow: "hidden",
        paddingHorizontal: 6,
        paddingVertical: compact ? 0 : 3,
        borderRadius: 5,
        borderLeftWidth: 3,
        borderColor: color,
        // Solid, on the window's ground: the hour lines stop at its edge, and a block drawn over another hides what it covers.
        backgroundColor: over(color, selected ? 0.55 : 0.26, surface.window),
        hoverBackgroundColor: over(color, selected ? 0.6 : 0.4, surface.window),
        ...(placed.left > 0 ? { shadow: "sm" as const } : {}),
        opacity: dragged ? 0.35 : 1,
        focusRingColor: colors.focusRing,
      }}
    >
      {/* The title first: it takes the room, and the time gives way before it does. */}
      <View style={compact ? { flexShrink: 1, minWidth: 0 } : { width: "100%" }}>
        <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "semibold", color: colors.text }}>
          {titleOf(event)}
        </Text>
      </View>
      {parts.time && (
        <View style={compact ? { flexShrink: 0 } : { width: "100%" }}>
          <Text numberOfLines={1} style={{ fontSize: 10, color: colors.textMuted }}>
            {clock(occurrence.start, prefs)}
          </Text>
        </View>
      )}
      {parts.place && event.location !== "" && (
        <View style={{ width: "100%" }}>
          <Text numberOfLines={1} style={{ fontSize: 10, color: colors.textMuted }}>
            {event.location}
          </Text>
        </View>
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
