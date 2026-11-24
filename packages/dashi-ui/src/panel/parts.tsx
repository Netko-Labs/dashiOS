/**
 * The small parts Control Center's tiles are drawn from, which System
 * Settings, the battery panel and the tiles' pages draw with too
 * (docs/design.html, "Control Center" and "Settings"): a round knob holding
 * a glyph, the chip a slider's glyph sits on, a slider's ink fill, the
 * reading's bar with the charge limit's tick.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { pill, RADIUS, SPACE, TYPE, useColors } from "../theme/index.ts";
import { useControlColors } from "./colors.ts";

/**
 * A glyph on a round knob: a Settings row's (40, its circle at rest), a
 * sidebar pill's (26), a wide tile's (44). `on` fills it Dashi green with
 * the tighter corner, as a tile that is on.
 */
export function Knob({
  glyph,
  size = 40,
  glyphSize = 18,
  on = false,
  ground,
}: {
  glyph: string;
  size?: number;
  glyphSize?: number;
  on?: boolean;
  ground?: string;
}) {
  const colors = useControlColors();
  return (
    <View
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: on ? Math.round(size * 0.31) : size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? colors.on : (ground ?? colors.knobRest),
      }}
    >
      <Svg markup={glyph} size={glyphSize} color={on ? colors.onInk : colors.offInk} />
    </View>
  );
}

/** The chip a slider's glyph sits on: 32 across, the surface's color. */
const SLIDER_CHIP = 32;

export function GlyphDisc({ glyph }: { glyph: string }) {
  const colors = useControlColors();
  return (
    <View
      style={{
        width: SLIDER_CHIP,
        height: SLIDER_CHIP,
        borderRadius: pill(SLIDER_CHIP),
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.chip,
      }}
    >
      <Svg markup={glyph} size={18} color={colors.text} />
    </View>
  );
}

/**
 * The ink fill of a slider `length` along a track `total` long: rounded at
 * the end it grows from (the track's corners, `radius`), square at its
 * moving edge until it nears the far end.
 */
export function InkFill({ length, total, standing, radius }: { length: number; total: number; standing: boolean; radius: number }) {
  const colors = useControlColors();
  if (length <= 0) return null;
  const r = radius;
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

/** Under this charge a reading turns ume (CO-13). */
export const LOW_CHARGE = 10;

/**
 * A reading's bar filled to `percent` in the fill's ink, ume under 10 %
 * (CO-13: a reading is never "on"), with a tick at the charge limit (the
 * battery row, the battery panel's gauge, Settings' battery hero). Widths
 * are shares of the bar, so it fits whatever room it is given.
 */
export function LimitBar({ percent, limit, height, label }: { percent: number; limit: number | null; height: number; label?: boolean }) {
  const colors = useControlColors();
  const { critical } = useColors();
  const share = (value: number): `${number}%` => `${Math.min(Math.max(value, 0), 100)}%`;
  const tick = height + 8;
  return (
    <View style={{ flex: 1, height, borderRadius: height / 2, backgroundColor: colors.line, position: "relative" }}>
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: share(percent),
          borderRadius: height / 2,
          backgroundColor: percent < LOW_CHARGE ? critical : colors.fill,
        }}
      />
      {limit !== null && limit < 100 && (
        <View style={{ position: "absolute", left: 0, right: 0, top: -4, height: tick, flexDirection: "row" }}>
          <View style={{ width: share(limit) }} />
          <View testID="limit-tick" style={{ marginLeft: -1, width: 2, height: tick, borderRadius: pill(RADIUS.thumb), backgroundColor: colors.muted }} />
          {label && (
            <View style={{ position: "absolute", left: 0, right: 0, top: -14, flexDirection: "row" }}>
              <View style={{ width: share(limit), marginLeft: -SPACE.m }} />
              <Text style={{ fontSize: TYPE.panel.micro.size, color: colors.muted }}>{String(limit)}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
