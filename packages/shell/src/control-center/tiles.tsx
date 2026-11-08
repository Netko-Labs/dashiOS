/**
 * Control Center's tiles as drawn (docs/design.html, "Control Center"):
 *
 * - a **wide** tile is a pill with a round knob and its label; on, it turns
 *   Dashi green and its corners tighten from 28 to 18 (motion.ts). The knob
 *   toggles; the label opens the tile's page (or toggles, without one).
 * - a **round** tile is the glyph with a word under it; a press toggles.
 * - a **slider** fills with ink, its level at the top at rest, its glyph on a
 *   chip at the bottom (a flat one: the label on a chip, the level at the right).
 * - the **battery** row: the glyph (the bolt only while charging), the
 *   charge, a bar with a tick at the limit, and the time.
 *
 * Every tile sits at its frame in the grid (grid.tsx); a dimmed one is an
 * applet's that isn't running.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { GRID } from "./layout.ts";
import { useSpring } from "./motion.ts";
import { useControlColors } from "./palette.ts";
import { fillLength, levelAt } from "./slider-math.ts";

/** Corners of a tile off, and on. */
export const TILE_RADIUS = { off: 28, on: 18 } as const;

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
  return useSpring(on ? TILE_RADIUS.on : TILE_RADIUS.off);
}

export function WideTile({ look, onToggle, onOpen }: { look: TileLook } & TilePress) {
  const colors = useControlColors();
  const radius = useTileRadius(look.on);
  const ink = look.on ? colors.onInk : colors.offInk;
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
        gap: 10,
        paddingLeft: 6,
        paddingRight: 14,
        borderRadius: radius,
        backgroundColor: look.on ? colors.on : colors.off,
        opacity: look.dim ? 0.5 : 1,
      }}
    >
      <View
        testID={`${look.testID}-knob`}
        onPress={onToggle ?? onOpen}
        style={{
          width: 44,
          height: 44,
          borderRadius: look.on ? radius - 4 : 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: look.on ? colors.knobOn : colors.knobOff,
        }}
      >
        <Svg markup={look.glyph} size={18} color={ink} />
      </View>
      <View style={{ flex: 1, flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: ink }}>
          {look.title}
        </Text>
        {look.detail !== null && (
          <Text numberOfLines={1} style={{ fontSize: 11, color: ink, opacity: 0.74 }}>
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
        gap: 2,
        borderRadius: radius,
        backgroundColor: look.on ? colors.on : colors.off,
        opacity: look.dim ? 0.5 : 1,
      }}
    >
      <Svg markup={look.glyph} size={18} color={ink} />
      <Text numberOfLines={1} style={{ fontSize: 10.5, fontWeight: "semibold", color: ink, opacity: 0.85 }}>
        {look.title}
      </Text>
    </View>
  );
}

/** The chip a slider's glyph sits on. */
function Chip({ glyph }: { glyph: string }) {
  const colors = useControlColors();
  return (
    <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.chip }}>
      <Svg markup={glyph} size={18} color={colors.text} />
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
 * The ink fill of a slider: rounded at the end it grows from (the track's
 * corners), square at its moving edge until it nears the far end.
 */
function Fill({ length, total, standing }: { length: number; total: number; standing: boolean }) {
  const colors = useControlColors();
  if (length <= 0) return null;
  const r = GRID.radius;
  const rounded = Math.min(length, total);
  const square = length > r && length < total - r ? length - r : 0;
  const along = (size: number) => (standing ? { left: 0, right: 0, bottom: 0, height: size } : { top: 0, bottom: 0, left: 0, width: size });
  return (
    <>
      <View style={{ position: "absolute", ...along(rounded), borderRadius: Math.min(r, rounded / 2), backgroundColor: colors.fill }} />
      {square > 0 && (
        <View
          style={{
            position: "absolute",
            ...(standing ? { left: 0, right: 0, bottom: r, height: square } : { top: 0, bottom: 0, left: r, width: square }),
            backgroundColor: colors.fill,
          }}
        />
      )}
    </>
  );
}

export function SliderTile({ look, standing, onLevel }: { look: SliderLook; standing: boolean; onLevel: (level: number) => void }) {
  const colors = useControlColors();
  const length = standing ? look.height : look.width;
  const fill = fillLength(look.level, length);
  const drag = (x: number, y: number, bounds?: { x: number; y: number; width: number; height: number }) => {
    if (bounds) onLevel(levelAt(bounds, x, y, standing));
  };
  // Words on the ink take its ink; on the track, the muted text.
  const valueOnInk = standing ? fill > look.height - 24 : fill > look.width - 48;
  return (
    <View
      testID={look.testID}
      onPointer={(event) => drag(event.x, event.y, event.bounds)}
      accessibilityRole="group"
      accessibilityLabel={`${look.title}, ${look.value}`}
      style={{ flex: 1, position: "relative", borderRadius: GRID.radius, backgroundColor: colors.off, overflow: "hidden" }}
    >
      <Fill length={fill} total={length} standing={standing} />
      {standing ? (
        <>
          <View style={{ position: "absolute", top: 12, left: 0, right: 0, alignItems: "center" }}>
            <Text style={{ fontSize: 11, fontWeight: "semibold", color: valueOnInk ? colors.fillInk : colors.muted }}>{look.value}</Text>
          </View>
          <View style={{ position: "absolute", bottom: 10, left: 0, right: 0, alignItems: "center" }}>
            <Chip glyph={look.glyph} />
          </View>
        </>
      ) : (
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 12, paddingRight: 14 }}>
          <Chip glyph={look.glyph} />
          <View style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2, borderRadius: 10, backgroundColor: colors.chip }}>
            <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>{look.title}</Text>
          </View>
          <View style={{ marginLeft: "auto" }}>
            <Text style={{ fontSize: 11, fontWeight: "semibold", color: valueOnInk ? colors.fillInk : colors.muted }}>{look.value}</Text>
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

export function BatteryRow({ look, onOpen }: { look: BatteryLook; onOpen: () => void }) {
  const colors = useControlColors();
  return (
    <View
      testID="cc-battery"
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Battery ${look.percent}%`}
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingLeft: 6,
        paddingRight: 16,
        borderRadius: GRID.radius,
        backgroundColor: colors.off,
      }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.knobOff }}>
        <Svg markup={look.glyph} size={18} color={colors.offInk} />
      </View>
      <Text style={{ fontSize: 12.5, fontWeight: "semibold", color: colors.offInk }}>{`${look.percent}%`}</Text>
      <LimitBar percent={look.percent} limit={look.limit} height={8} />
      {look.time && <Text style={{ fontSize: 12.5, color: colors.muted }}>{look.time}</Text>}
    </View>
  );
}

/**
 * A bar filled to `percent` in Dashi green, with a tick at the charge limit
 * (the battery row, the battery panel's gauge). Widths are shares of the
 * bar, so it fits whatever room it is given.
 */
export function LimitBar({ percent, limit, height, label }: { percent: number; limit: number | null; height: number; label?: boolean }) {
  const colors = useControlColors();
  const share = (value: number): `${number}%` => `${Math.min(Math.max(value, 0), 100)}%`;
  const tick = height + 8;
  return (
    <View style={{ flex: 1, height, borderRadius: height / 2, backgroundColor: colors.line, position: "relative" }}>
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: share(percent), borderRadius: height / 2, backgroundColor: colors.on }} />
      {limit !== null && limit < 100 && (
        <View style={{ position: "absolute", left: 0, right: 0, top: -4, height: tick, flexDirection: "row" }}>
          <View style={{ width: share(limit) }} />
          <View testID="limit-tick" style={{ marginLeft: -1, width: 2, height: tick, borderRadius: 1, backgroundColor: colors.muted }} />
          {label && (
            <View style={{ position: "absolute", left: 0, right: 0, top: -14, flexDirection: "row" }}>
              <View style={{ width: share(limit), marginLeft: -8 }} />
              <Text style={{ fontSize: 10, color: colors.muted }}>{String(limit)}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/** The keyboard's ring: 2 px of purple, 2 px out, round with the tile. */
export function FocusRing({ radius }: { radius: number }) {
  const colors = useControlColors();
  return (
    <View
      testID="cc-focus-ring"
      style={{ position: "absolute", left: -4, top: -4, right: -4, bottom: -4, borderRadius: radius + 4, borderWidth: 2, borderColor: colors.focus }}
    />
  );
}

/** A tile in place: absolutely at its frame, its ring when the keyboard is on it. */
export function TileFrame({
  frame,
  focused,
  radius,
  children,
}: {
  frame: { left: number; top: number; width: number; height: number };
  focused: boolean;
  radius: number;
  children: ReactNode;
}) {
  return (
    <View style={{ position: "absolute", left: frame.left, top: frame.top, width: frame.width, height: frame.height, flexDirection: "column" }}>
      {children}
      {focused && <FocusRing radius={radius} />}
    </View>
  );
}
