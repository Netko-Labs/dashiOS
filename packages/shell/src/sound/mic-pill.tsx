/**
 * The menu bar's microphone indicator: while any app records from a
 * microphone, an orange pill with the microphone in it (docs/design.html,
 * "The menu bar"). It is a privacy item, as the agent mark is (MB-2): it
 * never goes into "…". Pointing at it names the apps in the bar's tooltip;
 * a click opens Control Center's Sound page, which lists them under "Using
 * the microphone". Recording this computer's own sound is not the
 * microphone and doesn't light it.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, Svg, View } from "@mirinjs/metal";
import { useRef } from "react";
import { MICROPHONE } from "../settings-app/glyphs-machine.ts";
import type { MicIndicator } from "./apps/index.ts";

/** A pill 20 tall, radius 10, 7 in; the glyph 13. */
export const MIC_PILL = { height: 20, padding: 7, glyph: 13 } as const;

export interface MicPillProps {
  state: MicIndicator;
  /** With the pill's right edge in the bar. */
  onPress: (right: number) => void;
  /** Show or take down the bar's tooltip under the pill. */
  onTip?: (tip: { text: string; bounds: Bounds } | null) => void;
}

export function MicPill({ state, onPress, onTip }: MicPillProps) {
  const colors = useColors();
  const laid = useRef<Bounds | null>(null);
  if (!state.on) return null;
  const box = (bounds?: Bounds) => bounds ?? laid.current ?? { x: 0, y: 0, width: 0, height: 0 };
  return (
    <View
      testID="mic-indicator"
      onLayout={(bounds) => {
        laid.current = bounds;
      }}
      onPress={({ bounds }) => {
        onTip?.(null);
        const at = box(bounds);
        onPress(at.x + at.width);
      }}
      onHoverChange={(hovered, bounds) => onTip?.(hovered ? { text: state.words, bounds: box(bounds) } : null)}
      accessibilityRole="button"
      accessibilityLabel={state.words}
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        height: MIC_PILL.height,
        paddingLeft: MIC_PILL.padding,
        paddingRight: MIC_PILL.padding,
        borderRadius: MIC_PILL.height / 2,
        backgroundColor: colors.microphoneWash,
      }}
    >
      <Svg markup={MICROPHONE} size={MIC_PILL.glyph} color={colors.microphone} />
    </View>
  );
}
