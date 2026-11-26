/**
 * A glyph on a round knob that acts: the panel look's round button
 * (docs/design.html, "Control Center"): a tile page's Back, a mute, edit
 * mode's "−" and "+", the menu bar's microphone pill. At rest it is the
 * knob's circle (`ground`, the off knob by default); on a lit tile (`lit`)
 * the on knob under the on ink; `inked` fills it with ink (a mark that adds
 * or removes, a mute that is on: ink, never the on colour, CC-1). Given
 * `checked` it is a switch (a mute), and inked while checked. Named for
 * screen readers, a Tab stop unless `focusable` is false (Control Center's
 * pages have their own keys).
 */

import { type Bounds, type PressInfo, Svg, View } from "@mirinjs/metal";
import { useFocusGap } from "../frosted.tsx";
import { pill } from "../theme/index.ts";
import { knobEdge, useControlColors } from "./colors.ts";

/** Its default measures: a 40 knob, an 18 glyph. */
export const KNOB_BUTTON = { size: 40, glyph: 18 } as const;

export interface KnobButtonProps {
  testID: string;
  glyph: string;
  /** What a screen reader calls it ("Back", "Mute Helium", "Add Wi-Fi"). */
  label: string;
  onPress: (event: PressInfo) => void;
  /** Its height, and width unless `width` says (a pill: the microphone's). */
  size?: number;
  width?: number;
  glyphSize?: number;
  /** A switch's state (a mute); a button without it. */
  checked?: boolean;
  /** Filled with ink: an add or remove mark, a mute that is on. */
  inked?: boolean;
  /** On a lit tile: the on knob and the on ink. */
  lit?: boolean;
  /** Its ground and glyph at rest, when they are a job's own (the microphone's wash and ink). */
  ground?: string;
  ink?: string;
  focusable?: boolean;
  onLayout?: (bounds: Bounds) => void;
  onHoverChange?: (hovered: boolean, bounds?: Bounds) => void;
}

export function KnobButton({
  testID,
  glyph,
  label,
  onPress,
  size = KNOB_BUTTON.size,
  width,
  glyphSize = KNOB_BUTTON.glyph,
  checked,
  inked,
  lit,
  ground,
  ink,
  focusable = true,
  onLayout,
  onHoverChange,
}: KnobButtonProps) {
  const colors = useControlColors();
  const filled = inked === true || checked === true;
  const fill = filled ? colors.fill : lit ? colors.knobOn : (ground ?? colors.knobOff);
  const glyphInk = filled ? colors.fillInk : lit ? colors.onInk : (ink ?? colors.offInk);
  const gap = useFocusGap(lit === true, colors.onInk);
  return (
    <View
      testID={testID}
      onPress={onPress}
      focusable={focusable}
      accessibilityRole={checked === undefined ? "button" : "switch"}
      accessibilityLabel={label}
      {...(checked === undefined ? {} : { accessibilityState: { checked } })}
      {...(onLayout ? { onLayout } : {})}
      {...(onHoverChange ? { onHoverChange } : {})}
      style={{
        width: width ?? size,
        height: size,
        flexShrink: 0,
        borderRadius: pill(size),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: fill,
        ...knobEdge(colors, filled || lit === true),
        ...gap,
        focusRingColor: colors.focus,
      }}
    >
      <Svg markup={glyph} size={glyphSize} color={glyphInk} />
    </View>
  );
}
