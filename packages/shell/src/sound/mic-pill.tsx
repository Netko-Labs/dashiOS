/**
 * The menu bar's microphone indicator: while any app records from a
 * microphone, an orange pill with the microphone in it (docs/design.html,
 * "The menu bar"). It is a privacy item, as the agent mark is (MB-2): it
 * never goes into "…". Pointing at it names the apps in the bar's tooltip;
 * a click opens Control Center's Sound page, which lists them under "Using
 * the microphone". Recording this computer's own sound is not the
 * microphone and doesn't light it.
 */

import { KnobButton, useColors } from "@dashi/ui";
import type { Bounds } from "@mirinjs/metal";
import { useRef } from "react";
import { MICROPHONE } from "../settings-app/glyphs-machine.ts";

/** A pill 20 tall, radius 10, 7 in; the glyph 13 (the menu bar reaches it by its own keys, not Tab). */
export const MIC_PILL = { height: 20, inset: 7, glyph: 13 } as const;

export interface MicPillProps {
  /** What it says, "Signal is using the microphone."; none draws nothing. */
  words: string;
  /** With the pill's right edge in the bar. */
  onPress: (right: number) => void;
  /** Show or take down the bar's tooltip under the pill. */
  onTip?: (tip: { text: string; bounds: Bounds } | null) => void;
}

/** The pill on the kit's KnobButton: the microphone's own wash and ink (its job's colours, not the on colour). */
export function MicIndicator({ words, onPress, onTip }: MicPillProps) {
  const colors = useColors();
  const laid = useRef<Bounds | null>(null);
  if (words === "") return null;
  const box = (bounds?: Bounds) => bounds ?? laid.current ?? { x: 0, y: 0, width: 0, height: 0 };
  return (
    <KnobButton
      testID="mic-indicator"
      glyph={MICROPHONE}
      label={words}
      size={MIC_PILL.height}
      width={MIC_PILL.glyph + 2 * MIC_PILL.inset}
      glyphSize={MIC_PILL.glyph}
      ground={colors.microphoneWash}
      ink={colors.microphone}
      focusable={false}
      onLayout={(bounds) => {
        laid.current = bounds;
      }}
      onPress={({ bounds }) => {
        onTip?.(null);
        const at = box(bounds);
        onPress(at.x + at.width);
      }}
      onHoverChange={(hovered, bounds) => onTip?.(hovered ? { text: words, bounds: box(bounds) } : null)}
    />
  );
}
