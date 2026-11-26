/**
 * The widget column: the person's widgets on the 80-point grid, in their
 * order (layout.ts). A press opens what a widget is about (the area closes;
 * on the lock screen the password comes first, saying what will open).
 */

import { View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { widgetInfo } from "./catalog.ts";
import { useWidgetEnv } from "./env.tsx";
import { COLUMN_WIDTH, columnHeight, packColumn } from "./layout.ts";
import { useSource } from "./lib/data.ts";
import { kindOfKey, WidgetTile } from "./lib/views/widget.tsx";
import type { Placed, Placement } from "./types.ts";

export interface WidgetColumnProps {
  placements: readonly Placement[];
  /** What a press on a widget opens; none: nothing. */
  openerOf?: (placement: Placement) => (() => void) | null;
  /** Drawn over each widget while editing (its minus, grab cue, edges). */
  decorate?: (placed: Placed, tile: ReactNode) => ReactNode;
  testID?: string;
}

export function WidgetColumn({ placements, openerOf, decorate, testID = "widget-column" }: WidgetColumnProps) {
  const env = useWidgetEnv();
  const extensions = useSource(env.hub?.extensions, []);
  const placed = packColumn(placements);
  const holderKind = env.tally.holder ? kindOfKey(env.tally.holder) : null;
  // A holder drawn as a live card above does not put its widget on air too: timers, runs and asks are live cards.
  const onAir = holderKind === "media" || holderKind === "calendar" || holderKind === "weather";
  let shown = false;
  return (
    <View testID={testID} style={{ width: COLUMN_WIDTH, height: columnHeight(placed) }}>
      {placed.map((each) => {
        const air = onAir && !shown && each.placement.kind === holderKind;
        if (air) shown = true;
        const info = widgetInfo(
          each.placement.kind,
          extensions.map((ext) => ext.info),
        );
        const opener = openerOf?.(each.placement) ?? null;
        const tile = (
          <WidgetTile
            kind={each.placement.kind}
            size={each.placement.size}
            width={each.width}
            height={each.height}
            showPrivate={each.placement.showPrivateWhenLocked === true}
            air={air}
            testID={`widget:${each.placement.id}`}
            {...(opener ? { onPress: () => env.open({ label: info?.name ?? "it", run: opener }) } : {})}
          />
        );
        return (
          <View key={each.placement.id} style={{ position: "absolute", left: each.x, top: each.y, width: each.width, height: each.height }}>
            {decorate ? decorate(each, tile) : tile}
          </View>
        );
      })}
    </View>
  );
}
