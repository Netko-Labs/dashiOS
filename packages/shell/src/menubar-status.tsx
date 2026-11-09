/**
 * The menu bar's status side: the items right of the app's menus, in one
 * row that never wraps or grows (VS: one chrome row). Each item is measured
 * as it draws; when they don't all fit in the room the menus leave
 * (`fitStatus`, menubar-fit.ts), those whose turn it is go into "…", whose
 * popover (bar-overflow.tsx) shows them in a row. "…" is there only while
 * something went, with a dot when one of those wants attention.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, Svg, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { fitStatus, MORE_WIDTH, STATUS_GAP, statusRow, UNMEASURED } from "./menubar-fit.ts";
import { type BarStop, MORE_STOP, type StopKind } from "./menus/bar-keys.ts";
import { useControlColors } from "./shared/controls/palette.ts";

/** "…": three dots on the status glyphs' grid. */
export const MORE_GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1.3" fill="#000"/><circle cx="8" cy="8" r="1.3" fill="#000"/><circle cx="12.5" cy="8" r="1.3" fill="#000"/></svg>`;

/** "…"'s name for a screen reader. */
const MORE_LABEL = "More menu bar items";

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

/**
 * The keyboard's ring on a bar item (menus/bar-keys.ts): 2 px of the
 * focus purple on the item's own edge. The bar is one 28-tall row, so the
 * ring stays inside the item rather than 2 out (VS-1).
 */
export function BarRing({ radius }: { radius: number }) {
  const colors = useControlColors();
  return (
    <View
      testID="bar-ring"
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, borderRadius: radius, borderWidth: 2, borderColor: colors.focus }}
    />
  );
}

/**
 * One status glyph and the room around it to click. The glyphs sit side by
 * side with no gaps, so every pixel of the area is some item's.
 */
export function StatusItem({
  testID,
  onPress,
  open = false,
  label,
  children,
}: {
  testID: string;
  /** Its name for a screen reader, on a host that takes accessibility props (menubar.tsx `accessible`). */
  label?: string;
  /** With the item's bounds in the bar, when the event carries them. */
  onPress: (bounds?: Bounds) => void;
  /** Its own menu is open: the item's pill is drawn pressed. */
  open?: boolean;
  children: ReactNode;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={({ bounds }) => onPress(bounds)}
      {...(label === undefined ? {} : { accessibilityRole: "button" as const, accessibilityLabel: label, accessibilityState: { expanded: open } })}
      style={{
        height: 22,
        paddingLeft: 7,
        paddingRight: 7,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 5,
        backgroundColor: open ? colors.switcherSelection : "#00000000",
      }}
    >
      {children}
    </View>
  );
}

function More({
  open,
  attention,
  focused,
  onPress,
  onBounds,
  accessible,
}: {
  open: boolean;
  attention: boolean;
  focused: boolean;
  onPress: (right: number) => void;
  onBounds: (bounds: Bounds) => void;
  accessible: boolean;
}) {
  const colors = useColors();
  const laid = useRef<Bounds | null>(null);
  return (
    <View
      testID="status-more"
      {...(accessible ? { accessibilityRole: "button" as const, accessibilityLabel: MORE_LABEL, accessibilityState: { expanded: open } } : {})}
      onLayout={(bounds) => {
        laid.current = bounds;
        onBounds(bounds);
      }}
      onPress={({ bounds }) => {
        const box = bounds ?? laid.current;
        onPress(box ? box.x + box.width : 0);
      }}
      style={{
        flexShrink: 0,
        width: MORE_WIDTH,
        height: MORE_WIDTH,
        borderRadius: MORE_WIDTH / 2,
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        backgroundColor: open ? colors.switcherSelection : "#00000000",
      }}
    >
      <Svg markup={MORE_GLYPH} size={16} color={colors.text} />
      {focused && <BarRing radius={MORE_WIDTH / 2} />}
      {attention && (
        <View
          testID="status-more-attention"
          style={{ position: "absolute", top: 1, right: 1, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.critical }}
        />
      )}
    </View>
  );
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

export function StatusSide({ slots, room, areaOpen, moreOpen, onMore, onHidden, focused = null, onStops, accessible = false }: StatusSideProps) {
  const colors = useColors();
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
  const shown = new Set(fit.shown);
  const hiddenKey = fit.hidden.join("\n");
  useEffect(() => {
    onHidden?.(hiddenKey === "" ? [] : hiddenKey.split("\n"));
  }, [hiddenKey, onHidden]);
  const attention = slots.some((slot) => slot.attention && !shown.has(slot.key));
  const wrap = (slot: StatusSlot) => (
    <View key={slot.key} testID={`status-slot:${slot.key}`} style={{ flexShrink: 0, position: "relative" }} onLayout={(bounds) => measure(slot.key, bounds)}>
      {slot.node}
      {focused === slot.key && <BarRing radius={slot.radius ?? 5} />}
    </View>
  );
  // "…" stands right of the extras still shown, where the ones that went were: the newest are leftmost.
  const row = statusRow(slots, fit.hidden, MORE_STOP);
  const visible = slots.filter((slot) => shown.has(slot.key));
  const moreAt = row.moreAt;
  const moreBounds = (bounds: Bounds) => placed.current.set(MORE_STOP, bounds);
  // The keyboard's stops, in the row's order: items that open or act, and "…".
  const stops: BarStop[] = row.order.flatMap((key): BarStop[] => {
    if (key === MORE_STOP) {
      const run = () => {
        const box = placed.current.get(MORE_STOP);
        onMore(box ? box.x + box.width : 0, fit.hidden);
      };
      return [{ key, label: MORE_LABEL, kind: "panel", open: run }];
    }
    const slot = slots.find((each) => each.key === key);
    if (!slot?.open) return [];
    const { kind, run } = slot.open;
    return [{ key, label: slot.label ?? key, kind, open: () => run(placed.current.get(key) ?? null) }];
  });
  useEffect(() => onStops?.(stops));
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
          backgroundColor: areaOpen ? colors.switcherSelection : "#00000000",
        }}
      >
        {area}
      </View>,
    );
    area = null;
  };
  const more = (
    <More
      key="status-more"
      open={moreOpen}
      attention={attention}
      focused={focused === MORE_STOP}
      onPress={(right) => onMore(right, fit.hidden)}
      onBounds={moreBounds}
      accessible={accessible}
    />
  );
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
