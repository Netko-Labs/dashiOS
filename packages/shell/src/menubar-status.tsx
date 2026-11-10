/**
 * The menu bar's status side: the items right of the app's menus, in one
 * row that never wraps or grows (VS: one chrome row). Each item is measured
 * as it draws; when they don't all fit in the room the menus leave
 * (`fitStatus`, menubar-fit.ts), those whose turn it is go into "…", whose
 * popover (bar-overflow.tsx) shows them in a row. "…" is there only while
 * something went, with a dot when one of those wants attention.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { fitStatus, MORE_WIDTH, STATUS_GAP, statusRow, UNMEASURED } from "./menubar-fit.ts";
import { BarRing, MORE_LABEL, More } from "./menubar-items.tsx";
import { type BarStop, MORE_STOP, type StopKind } from "./menus/index.ts";

export { BarRing, StatusItem } from "./menubar-items.tsx";

export interface StatusSlot {
  key: string;
  /** Its turn to go into "…", lowest first; null: it never goes. */
  goes: number | null;
  /** Drawn inside the status area's one pill (battery to Control Center), which is pressed while Control Center is open. */
  inArea?: boolean;
  /** An app's or applet's item: "…" stands right of these. */
  extra?: boolean;
  /** It wants attention: "…" gets a dot while it is hidden. */
  attention?: boolean;
  /** What a screen reader says for it, and as the keyboard's ring reaches it (menus/bar-keys.ts). */
  label?: string;
  /** Opening it from the keyboard, as a click does, with where it is drawn; a slot without it is passed over. */
  open?: { kind: StopKind; run(bounds: Bounds | null): void };
  /** Its pill's corner radius, for the ring (5 when not said). */
  radius?: number;
  node: ReactNode;
}

export interface StatusSideProps {
  slots: readonly StatusSlot[];
  /** The room the menus leave (menubar-fit.ts `statusRoom`); null until the bar is measured, when everything shows. */
  room: number | null;
  /** The status area's pill is pressed (Control Center is open). */
  areaOpen: boolean;
  moreOpen: boolean;
  /** "…" was clicked: its right edge, and the hidden items' keys in the bar's order. */
  onMore: (right: number, hidden: readonly string[]) => void;
  /** What is hidden now, whenever it changes (an open "…" follows it). */
  onHidden?: (hidden: readonly string[]) => void;
  /** The item the keyboard's ring is on (a slot's key, or "more"); null for none. */
  focused?: string | null;
  /** The row's stops for the keyboard, left to right, after each draw (menus/bar-keys.ts). */
  onStops?: (stops: BarStop[]) => void;
  /** The Metal host takes accessibility props: "…" is named. */
  accessible?: boolean;
}

/** Each item's width and place as drawn, and what fits: the items that go into "…" while the room is short. */
function useStatusFit(slots: readonly StatusSlot[], room: number | null, onHidden: StatusSideProps["onHidden"]) {
  // Each item's width as last drawn: a hidden one keeps the width it had, so it comes back when that much room does.
  const widths = useRef(new Map<string, number>());
  // Where each item is drawn, for opening one from the keyboard.
  const placed = useRef(new Map<string, Bounds>());
  const [, remeasured] = useState(0);
  const measure = (key: string, bounds: Bounds) => {
    placed.current.set(key, bounds);
    const width = bounds.width;
    const was = widths.current.get(key);
    if (was !== undefined && Math.abs(was - width) < 0.5) return;
    widths.current.set(key, width);
    remeasured((n) => n + 1);
  };
  // The row's gap counts with each top-level item; the area's items touch.
  const items = slots.map((slot) => ({ key: slot.key, goes: slot.goes, width: (widths.current.get(slot.key) ?? UNMEASURED) + (slot.inArea ? 0 : STATUS_GAP) }));
  const fit = room === null ? { shown: slots.map((slot) => slot.key), hidden: [] } : fitStatus(items, room, 0, MORE_WIDTH + STATUS_GAP);
  const hiddenKey = fit.hidden.join("\n");
  useEffect(() => {
    onHidden?.(hiddenKey === "" ? [] : hiddenKey.split("\n"));
  }, [hiddenKey, onHidden]);
  return { fit, placed, measure };
}

/** The keyboard's stops, in the row's order: items that open or act, and "…". */
function statusStops(
  order: readonly string[],
  slots: readonly StatusSlot[],
  placed: Map<string, Bounds>,
  hidden: readonly string[],
  onMore: StatusSideProps["onMore"],
): BarStop[] {
  return order.flatMap((key): BarStop[] => {
    if (key === MORE_STOP) {
      const run = () => {
        const box = placed.get(MORE_STOP);
        onMore(box ? box.x + box.width : 0, hidden);
      };
      return [{ key, label: MORE_LABEL, kind: "panel", open: run }];
    }
    const slot = slots.find((each) => each.key === key);
    if (!slot?.open) return [];
    const { kind, run } = slot.open;
    return [{ key, label: slot.label ?? key, kind, open: () => run(placed.get(key) ?? null) }];
  });
}

/** The items in a row, "…" at `moreAt`; the ones marked `inArea` share one pill, pressed while Control Center is open. */
function arrangeStatus(
  visible: readonly StatusSlot[],
  moreAt: number,
  wrap: (slot: StatusSlot) => ReactNode,
  more: ReactNode,
  areaOpen: boolean,
  areaFill: string,
): ReactNode[] {
  const drawn: ReactNode[] = [];
  let area: ReactNode[] | null = null;
  const flushArea = () => {
    if (!area) return;
    drawn.push(
      <View
        key="status-area"
        testID="status-area"
        style={{
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          height: 22,
          borderRadius: 5,
          backgroundColor: areaOpen ? areaFill : "#00000000",
        }}
      >
        {area}
      </View>,
    );
    area = null;
  };
  visible.forEach((slot, index) => {
    if (index === moreAt) {
      flushArea();
      drawn.push(more);
    }
    if (slot.inArea) {
      area ??= [];
      area.push(wrap(slot));
      return;
    }
    flushArea();
    drawn.push(wrap(slot));
  });
  if (moreAt >= visible.length) {
    flushArea();
    drawn.push(more);
  }
  flushArea();
  return drawn;
}

export function StatusSide({ slots, room, areaOpen, moreOpen, onMore, onHidden, focused = null, onStops, accessible = false }: StatusSideProps) {
  const colors = useColors();
  const { fit, placed, measure } = useStatusFit(slots, room, onHidden);
  const shown = new Set(fit.shown);
  const attention = slots.some((slot) => slot.attention && !shown.has(slot.key));
  const wrap = (slot: StatusSlot) => (
    <View key={slot.key} testID={`status-slot:${slot.key}`} style={{ flexShrink: 0, position: "relative" }} onLayout={(bounds) => measure(slot.key, bounds)}>
      {slot.node}
      {focused === slot.key && <BarRing radius={slot.radius ?? 5} />}
    </View>
  );
  // "…" stands right of the extras still shown, where the ones that went were: the newest are leftmost.
  const row = statusRow(slots, fit.hidden, MORE_STOP);
  const stops = statusStops(row.order, slots, placed.current, fit.hidden, onMore);
  useEffect(() => onStops?.(stops));
  const more = (
    <More
      key="status-more"
      open={moreOpen}
      attention={attention}
      focused={focused === MORE_STOP}
      onPress={(right) => onMore(right, fit.hidden)}
      onBounds={(bounds) => placed.current.set(MORE_STOP, bounds)}
      accessible={accessible}
    />
  );
  const drawn = arrangeStatus(
    slots.filter((slot) => shown.has(slot.key)),
    row.moreAt,
    wrap,
    more,
    areaOpen,
    colors.switcherSelection,
  );
  return (
    <View
      testID="status-side"
      style={{
        marginLeft: "auto",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: STATUS_GAP,
        flexShrink: 1,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {drawn}
    </View>
  );
}
