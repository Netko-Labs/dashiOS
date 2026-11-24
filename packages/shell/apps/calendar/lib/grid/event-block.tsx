/**
 * A timed event on the day and week grid: a block at its time, its title and
 * start, and its place when there is room. Pressing it shows its popover;
 * dragging it moves it, and dragging its bottom edge (`RESIZE_EDGE` tall)
 * stretches it. Tab reaches it, and Space or Return shows the popover. While
 * it is dragged it stays faintly where it was.
 */

import { OPACITY, RADIUS, SHADOW, SPACE, TYPE, useColors, useSurface, WEIGHT } from "@dashi/ui";
import { type Bounds, type PointerInfo, Text, View } from "@mirinjs/metal";
import type { Occurrence } from "../../../../src/shared/calendar/index.ts";
import type { ClockPrefs } from "../../../../src/shared/time/index.ts";
import { over, tint } from "../colors.ts";
import { clock, titleOf } from "../format.ts";
import { type Placed, yAtMinutes } from "../layout.ts";
import type { DragKind } from "./drag.ts";

/** The strip at a block's foot that stretches it. */
export const RESIZE_EDGE = 6;
/** An event's edge in its calendar's colour, at its start; how far a block keeps from its column's sides. */
export const EVENT_EDGE = 3;
/** The ink ring round a picked bar (an all-day event, a month's bar). */
export const PICKED_RING = 2;
const SIDE = { left: 2, right: 4 } as const;
/** A block's least height, and a ghost's. */
const BLOCK_LEAST = 16;
const GHOST_LEAST = 14;
/** Its calendar's colour washed over the window's ground: at rest, under the pointer, picked, picked and under the pointer. */
const WASH = { rest: 0.26, hover: 0.4, picked: 0.55, pickedHover: 0.6, ghost: 0.5 } as const;
/** A block shorter than this is one line; from this tall it shows its place too. */
const ONE_LINE_BELOW = 34;
const PLACE_FROM = 46;

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
  const oneLine = height < ONE_LINE_BELOW;
  const known = width > 0;
  return {
    oneLine,
    time: !known || width >= (oneLine ? TIME_BESIDE_FROM : TIME_UNDER_FROM),
    place: !oneLine && height >= PLACE_FROM && (!known || width >= TIME_UNDER_FROM),
  };
}

export function EventBlock({ placed, color, width, prefs, selected, dragged, resizable, onPointer, onPress }: BlockProps) {
  const colors = useColors();
  const surface = useSurface();
  const { occurrence } = placed;
  const { event } = occurrence;
  const top = yAtMinutes(placed.top);
  const height = Math.max(yAtMinutes(placed.bottom - placed.top) - 1, BLOCK_LEAST);
  const room = width > 0 ? width - SIDE.left - SIDE.right : 0;
  const blockWidth = room > 0 ? (placed.right - placed.left) * room - 2 : 0;
  const parts = blockParts(blockWidth, height);
  const compact = parts.oneLine;
  return (
    <View
      testID={`event:${occurrenceKey(occurrence)}`}
      focusable
      // An event is a thing on the grid the person picks (its state says so), not a button.
      accessibilityRole="option"
      accessibilityState={{ selected }}
      accessibilityLabel={`${titleOf(event)}, ${clock(occurrence.start, prefs)}`}
      onPress={(info) => onPress(info.bounds)}
      onPointer={(info) => onPointer("move", info)}
      style={{
        position: "absolute",
        top,
        height,
        left: room > 0 ? SIDE.left + placed.left * room : SIDE.left,
        width: room > 0 ? blockWidth : "100%",
        flexDirection: compact ? "row" : "column",
        gap: compact ? SPACE.s : SPACE.px,
        alignItems: compact ? "center" : "flex-start",
        overflow: "hidden",
        paddingHorizontal: SPACE.s,
        paddingVertical: compact ? 0 : SPACE.xxs,
        borderRadius: RADIUS.row,
        borderLeftWidth: EVENT_EDGE,
        borderColor: color,
        // Solid, on the window's ground: the hour lines stop at its edge, and a block drawn over another hides what it covers.
        backgroundColor: over(color, selected ? WASH.picked : WASH.rest, surface.window),
        hoverBackgroundColor: over(color, selected ? WASH.pickedHover : WASH.hover, surface.window),
        ...(placed.left > 0 ? { shadow: SHADOW.sm } : {}),
        opacity: dragged ? OPACITY.disabled : 1,
        focusRingColor: colors.focusRing,
      }}
    >
      {/* The title first: it takes the room, and the time gives way before it does. */}
      <View style={compact ? { flexShrink: 1, minWidth: 0 } : { width: "100%" }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
          {titleOf(event)}
        </Text>
      </View>
      {parts.time && (
        <View style={compact ? { flexShrink: 0 } : { width: "100%" }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
            {clock(occurrence.start, prefs)}
          </Text>
        </View>
      )}
      {parts.place && event.location !== "" && (
        <View style={{ width: "100%" }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
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
        height: Math.max(yAtMinutes(bottom - top) - 1, GHOST_LEAST),
        left: SIDE.left,
        right: SIDE.right,
        flexDirection: "column",
        gap: SPACE.px,
        overflow: "hidden",
        paddingHorizontal: SPACE.s,
        paddingVertical: SPACE.xxs,
        borderRadius: RADIUS.row,
        borderLeftWidth: EVENT_EDGE,
        borderColor: color,
        backgroundColor: tint(color, WASH.ghost),
        // What a drag carries floats, as a menu does (DE-1).
        shadow: SHADOW.xl,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
        {title}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
        {times}
      </Text>
    </View>
  );
}
