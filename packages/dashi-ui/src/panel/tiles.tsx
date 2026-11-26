/**
 * Control Center's tiles, the panel look's toggles and readings
 * (docs/design.html, "Control Center"), drawn by the panel, Settings ›
 * Control Center's editor and Sound's page alike (UI-1):
 *
 * - a **wide** tile is a pill with a round knob and its label; on, it wears
 *   the one on and its corners tighten from 28 to 18 (motion.ts). The knob
 *   toggles; the label opens the tile's page (or toggles, without one).
 * - a **round** tile is the glyph with a word under it; a press toggles.
 * - a **slider** fills with ink, its level at the top at rest, its glyph on a
 *   chip at the bottom (a flat one: the label on a chip, the level at the right).
 * - the **battery** tile: the glyph, the charge, its bar in ink with a tick at
 *   the limit (a reading, never on: CC-1, CO-13), and the time.
 *
 * A dimmed tile is an applet's that isn't running (CC-3).
 */

import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { useFocusGap } from "../frosted.tsx";
import { fillLength, levelAt } from "../slider-math.ts";
import { OPACITY, pill, RADIUS, SPACE, TYPE, WEIGHT } from "../theme/index.ts";
import { knobEdge, useControlColors } from "./colors.ts";
import { useSpring } from "./motion.ts";
import { GlyphDisc, InkFill, LimitBar } from "./parts.tsx";

/** A tile's measures: its corners off and on, its knob and glyph, a flat slider's label chip, the battery's bar. */
export const TILE = {
  radius: { off: RADIUS.panel, on: 18 },
  knob: 44,
  /** How much tighter an on knob's corner is than its tile's. */
  knobTuck: SPACE.xs,
  glyph: 18,
  chipRadius: 10,
  bar: 8,
  /** Where a standing slider's level and glyph sit from its ends. */
  levelTop: SPACE.inset,
  glyphBottom: SPACE.gap,
  /** How near the ink must come to a value's words before they take the ink's colour. */
  valueRoom: { standing: 24, lying: 48 },
} as const;

export interface TileLook {
  testID: string;
  title: string;
  detail: string | null;
  glyph: string;
  on: boolean;
  /** An applet's control while the applet isn't running: its last state, dimmed. */
  dim?: boolean;
}

/** A press anywhere on a round tile, or on a wide tile's knob. */
export interface TilePress {
  onToggle?: () => void;
  /** The label of a wide tile (a round one: Return). */
  onOpen?: () => void;
}

function useTileRadius(on: boolean): number {
  return useSpring(on ? TILE.radius.on : TILE.radius.off);
}

const dimmed = (dim: boolean | undefined) => (dim ? { opacity: OPACITY.half } : {});

export function WideTile({ look, onToggle, onOpen }: { look: TileLook } & TilePress) {
  const colors = useControlColors();
  const radius = useTileRadius(look.on);
  const ink = look.on ? colors.onInk : colors.offInk;
  const gap = useFocusGap(look.on, colors.onInk);
  return (
    <View
      testID={look.testID}
      onPress={onOpen ?? onToggle}
      accessibilityRole={onOpen ? "button" : "switch"}
      accessibilityLabel={look.title}
      accessibilityState={{ checked: look.on }}
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.gap,
        paddingLeft: SPACE.s,
        paddingRight: SPACE.button,
        borderRadius: radius,
        backgroundColor: look.on ? colors.on : colors.off,
        ...gap,
        ...dimmed(look.dim),
      }}
    >
      <View
        testID={`${look.testID}-knob`}
        accessibilityRole={onToggle ? "switch" : "button"}
        accessibilityLabel={look.title}
        {...(onToggle ? { accessibilityState: { checked: look.on } } : {})}
        onPress={onToggle ?? onOpen}
        style={{
          width: TILE.knob,
          height: TILE.knob,
          borderRadius: look.on ? radius - TILE.knobTuck : pill(TILE.knob),
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: look.on ? colors.knobOn : colors.knobOff,
          ...knobEdge(colors, look.on),
        }}
      >
        <Svg markup={look.glyph} size={TILE.glyph} color={ink} />
      </View>
      <View style={{ flex: 1, flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: ink }}>
          {look.title}
        </Text>
        {look.detail !== null && (
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: ink, opacity: OPACITY.soft }}>
            {look.detail}
          </Text>
        )}
      </View>
    </View>
  );
}

export function RoundTile({ look, onToggle, onOpen }: { look: TileLook } & TilePress) {
  const colors = useControlColors();
  const radius = useTileRadius(look.on);
  const ink = look.on ? colors.onInk : colors.offInk;
  const gap = useFocusGap(look.on, colors.onInk);
  return (
    <View
      testID={look.testID}
      onPress={onToggle ?? onOpen}
      accessibilityRole="switch"
      accessibilityLabel={look.title}
      accessibilityState={{ checked: look.on }}
      style={{
        flex: 1,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: SPACE.xxs,
        borderRadius: radius,
        backgroundColor: look.on ? colors.on : colors.off,
        ...gap,
        ...dimmed(look.dim),
      }}
    >
      <Svg markup={look.glyph} size={TILE.glyph} color={ink} />
      <Text
        numberOfLines={1}
        style={{ fontSize: TYPE.panel.micro.size, fontWeight: WEIGHT.semibold, color: ink, opacity: OPACITY.strong, textAlign: "center" }}
      >
        {look.title}
      </Text>
    </View>
  );
}

export interface SliderLook {
  testID: string;
  title: string;
  glyph: string;
  level: number;
  /** What the level reads ("68%", "Muted"). */
  value: string;
  width: number;
  height: number;
}

/**
 * A slider tile. `lead` takes the glyph's place on a lying one (an app's
 * icon on its chip: Sound's apps). Its corners are the panel's, or a pill on
 * a tile less tall than that.
 */
export function SliderTile({ look, standing, onLevel, lead }: { look: SliderLook; standing: boolean; onLevel: (level: number) => void; lead?: ReactNode }) {
  const colors = useControlColors();
  const radius = Math.min(RADIUS.panel, pill(Math.min(look.width, look.height)));
  const length = standing ? look.height : look.width;
  const fill = fillLength(look.level, length);
  const drag = (x: number, y: number, bounds?: { x: number; y: number; width: number; height: number }) => {
    if (bounds) onLevel(levelAt(bounds, x, y, standing));
  };
  // Words on the ink take its ink; on the track, the muted text.
  const valueOnInk = standing ? fill > look.height - TILE.valueRoom.standing : fill > look.width - TILE.valueRoom.lying;
  const value = { fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: valueOnInk ? colors.fillInk : colors.muted } as const;
  return (
    <View
      testID={look.testID}
      onPointer={(event) => drag(event.x, event.y, event.bounds)}
      accessibilityRole="group"
      accessibilityLabel={`${look.title}, ${look.value}`}
      style={{ flex: 1, position: "relative", borderRadius: radius, backgroundColor: colors.off, overflow: "hidden" }}
    >
      <InkFill length={fill} total={length} standing={standing} radius={radius} />
      {standing ? (
        <>
          <View style={{ position: "absolute", top: TILE.levelTop, left: 0, right: 0, alignItems: "center" }}>
            <Text style={value}>{look.value}</Text>
          </View>
          <View style={{ position: "absolute", bottom: TILE.glyphBottom, left: 0, right: 0, alignItems: "center" }}>
            <GlyphDisc glyph={look.glyph} />
          </View>
        </>
      ) : (
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: SPACE.gap, paddingLeft: SPACE.inset, paddingRight: SPACE.button }}>
          {lead ?? <GlyphDisc glyph={look.glyph} />}
          <View style={{ paddingHorizontal: SPACE.m, paddingVertical: SPACE.xxs, borderRadius: TILE.chipRadius, backgroundColor: colors.chip }}>
            <Text style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{look.title}</Text>
          </View>
          <View style={{ marginLeft: "auto" }}>
            <Text style={value}>{look.value}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

export interface BatteryLook {
  percent: number;
  charging: boolean;
  /** The charge limit (a tick on the bar), null without one. */
  limit: number | null;
  /** "5 h 10 min", "16 min to 80%"; null when the battery can't say. */
  time: string | null;
  glyph: string;
}

/** The battery's tile: a press opens the battery panel. */
export function BatteryTile({ look, onOpen }: { look: BatteryLook; onOpen: () => void }) {
  const colors = useControlColors();
  return (
    <View
      testID="cc-battery"
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={look.time ? `Battery ${look.percent}%, ${look.time}` : `Battery ${look.percent}%`}
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.gap,
        paddingLeft: SPACE.s,
        paddingRight: SPACE.page,
        borderRadius: RADIUS.panel,
        backgroundColor: colors.off,
      }}
    >
      <View
        style={{
          width: TILE.knob,
          height: TILE.knob,
          borderRadius: pill(TILE.knob),
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.knobOff,
        }}
      >
        <Svg markup={look.glyph} size={TILE.glyph} color={colors.offInk} />
      </View>
      <Text style={{ fontSize: TYPE.panel.body.size, fontWeight: WEIGHT.semibold, color: colors.offInk }}>{`${look.percent}%`}</Text>
      <LimitBar percent={look.percent} limit={look.limit} height={TILE.bar} />
      {look.time && <Text style={{ fontSize: TYPE.panel.body.size, color: colors.muted }}>{look.time}</Text>}
    </View>
  );
}
