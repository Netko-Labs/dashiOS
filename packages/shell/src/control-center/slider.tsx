/**
 * A horizontal slider: click anywhere on the bar to set it, or press and
 * drag (Metal keeps sending the pointer to the bar until the button lifts).
 * The icon sits inside the fill, as in macOS.
 */

import { type Bounds, Svg, View } from "@mirinjs/metal";
import { useRef } from "react";
import { useColors } from "@dashi/ui";
import { fillWidth, KNOB, sliderValue } from "./slider-math.ts";

export function Slider({
  value,
  width,
  glyph,
  testID,
  onChange,
}: {
  /** 0 to 1. */
  value: number;
  /** The bar's width, which the layout fixes. */
  width: number;
  glyph: string;
  testID: string;
  onChange: (value: number) => void;
}) {
  const colors = useColors();
  // Pointer events carry the bar's bounds; the last layout stands in for one that does not.
  const laid = useRef<Bounds | null>(null);
  return (
    <View
      testID={testID}
      onLayout={(bounds) => {
        laid.current = bounds;
      }}
      onPointer={(event) => {
        const bounds = event.bounds ?? laid.current;
        if (bounds) onChange(sliderValue(event.x, bounds));
      }}
      style={{ width, height: KNOB, borderRadius: KNOB / 2, backgroundColor: colors.track, overflow: "hidden" }}
    >
      <View
        style={{
          width: fillWidth(value, width),
          height: KNOB,
          borderRadius: KNOB / 2,
          backgroundColor: "#ffffff",
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 7,
        }}
      >
        <Svg markup={glyph} size={14} color={colors.text} />
      </View>
    </View>
  );
}
