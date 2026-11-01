/**
 * What the panes are built from, in the way System Settings on the Mac
 * looks: a page with a title, then grouped cards of rows, choices as pills,
 * sliders, and buttons. The cards, rows, pills, and buttons are Dashi's
 * shared controls (../ui/, which the first-party apps use too); the page and
 * the slider are Settings' own. Everything paints with the shell's live
 * palette, so Dark Mode repaints Settings too.
 */

import { type Bounds, ScrollView, Text, useWindowChrome, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useColors } from "../theme.ts";
import { fractionAt, fractionOf, type Range, valueAt } from "./controls.ts";

export { Button, Caption, type Choice, Choices, Group, Note, Row, type Surface, Tile, useSurface } from "../ui/index.ts";

/**
 * A pane: its title, then its content scrolling under it when it is taller than the window. With
 * the unified title bar the title lives in the window's toolbar (view.tsx), so the page starts
 * with its content.
 */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  const unified = useWindowChrome().titleBar === "unified";
  return (
    <ScrollView testID={`pane:${title}`} style={{ flex: 1, flexDirection: "column", gap: 16, padding: 24, paddingTop: unified ? 8 : 20 }}>
      {!unified && <Text style={{ fontSize: 20, fontWeight: "bold", color: colors.text }}>{title}</Text>}
      {children}
    </ScrollView>
  );
}

const KNOB = 18;
const TRACK = 4;
/** A drag that stops moving for this long is saved, in case the release never arrives. */
const SETTLE_MS = 300;

/**
 * A slider: press or drag on the bar. While dragging it shows the pointer's
 * value; the value is handed to `onCommit` when the button lifts (or the
 * pointer rests), not on every move, so a drag is one write to the file.
 */
export function Slider({ value, range, width = 220, testID, onCommit }: { value: number; range: Range; width?: number; testID: string; onCommit: (value: number) => void }) {
  const colors = useColors();
  const [dragging, setDragging] = useState<number | null>(null);
  // Pointer events carry the bar's bounds; the last layout stands in for one that does not.
  const laid = useRef<Bounds | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pending.current), []);

  const commit = (next: number) => {
    clearTimeout(pending.current);
    setDragging(null);
    onCommit(next);
  };
  const shown = dragging ?? value;
  const knobLeft = fractionOf(shown, range) * (width - KNOB);
  return (
    <View
      testID={testID}
      onLayout={(bounds) => {
        laid.current = bounds;
      }}
      onPointer={(event) => {
        const bar = event.bounds ?? laid.current;
        if (!bar) return;
        const next = valueAt(fractionAt(event.x, bar, KNOB), range);
        setDragging(next);
        clearTimeout(pending.current);
        if (event.phase === "up") commit(next);
        else pending.current = setTimeout(() => commit(next), SETTLE_MS);
      }}
      style={{ width, height: KNOB + 4, position: "relative" }}
    >
      <View style={{ position: "absolute", left: 0, top: (KNOB + 4 - TRACK) / 2, width, height: TRACK, borderRadius: TRACK / 2, backgroundColor: colors.track }} />
      <View style={{ position: "absolute", left: 0, top: (KNOB + 4 - TRACK) / 2, width: knobLeft + KNOB / 2, height: TRACK, borderRadius: TRACK / 2, backgroundColor: colors.selection }} />
      <View style={{ position: "absolute", left: knobLeft, top: 2, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: "#ffffff", shadow: "sm" }} />
    </View>
  );
}

