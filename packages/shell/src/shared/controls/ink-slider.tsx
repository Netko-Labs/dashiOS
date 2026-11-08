/**
 * Control Center's flat slider as a setting's slider (docs/design.html,
 * "Settings"): a 40-tall track the color of a hairline, filled with ink
 * from the left, the setting's glyph on a chip at the left and its value at
 * the right (on the ink once the fill reaches it). Press anywhere to set it,
 * or press and drag; `onChange` hears every move, `onCommit` the value it
 * settled on (the button lifted, or the pointer rested), so a drag is one
 * write to a settings file. Tab reaches it and the arrows step it, as
 * @dashi/ui's slider does (`StepKeys`).
 */

import { DISABLED_OPACITY, fractionOf, keyValues, nearestIndex, type SliderRange, StepKeys, UNIT_RANGE, valueAt } from "@dashi/ui";
import { type Bounds, Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { useControlColors } from "./palette.ts";
import { Chip, InkFill } from "./parts.tsx";
import { fillLength, levelAt } from "./slider-math.ts";

/** 40 tall, round ends; the chip 4 in. */
export const INK_SLIDER = { height: 40, width: 260 } as const;
const SETTLE_MS = 300;
const CLICK_AFTER_POINTER_MS = 300;

export interface InkSliderProps {
  value: number;
  range?: SliderRange;
  testID: string;
  /** The glyph on the chip; none draws no chip. */
  glyph?: string;
  /** What the value reads at the right ("68%", "4500 K"); none shows none. */
  format?: (value: number) => string;
  width?: number;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  disabled?: boolean;
}

export function InkSlider({ value, range = UNIT_RANGE, testID, glyph, format, width = INK_SLIDER.width, onChange, onCommit, disabled }: InkSliderProps) {
  const colors = useControlColors();
  const [dragging, setDragging] = useState<number | null>(null);
  const [keyed, setKeyed] = useState<{ value: number; over: number } | null>(null);
  const laid = useRef<Bounds | null>(null);
  const pointerAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pending.current), []);

  const commit = (next: number): void => {
    clearTimeout(pending.current);
    setDragging(null);
    onCommit?.(next);
  };
  const shown = dragging ?? (keyed !== null && keyed.over === value ? keyed.value : value);
  const fill = fillLength(fractionOf(shown, range), width);
  const notches = keyValues(range);
  const words = format?.(shown);
  const radius = INK_SLIDER.height / 2;
  return (
    <View
      testID={testID}
      onLayout={(bounds) => {
        laid.current = bounds;
      }}
      onPointer={
        disabled
          ? undefined
          : (event) => {
              const bar = event.bounds ?? laid.current;
              if (!bar) return;
              pointerAt.current = performance.now();
              setKeyed(null);
              const next = valueAt(levelAt(bar, event.x, event.y, false), range);
              setDragging(next);
              onChange?.(next);
              clearTimeout(pending.current);
              if (event.phase === "up") commit(next);
              else if (onCommit) pending.current = setTimeout(() => commit(next), SETTLE_MS);
            }
      }
      accessibilityRole="group"
      accessibilityLabel={words ?? String(shown)}
      style={{
        width,
        height: INK_SLIDER.height,
        flexShrink: 0,
        position: "relative",
        borderRadius: radius,
        backgroundColor: colors.line,
        opacity: disabled ? DISABLED_OPACITY : 1,
      }}
    >
      <InkFill length={fill} total={width} standing={false} radius={radius} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: 4, paddingRight: 14 }}>
        {glyph !== undefined && <Chip glyph={glyph} />}
        {words !== undefined && (
          <View style={{ marginLeft: "auto" }}>
            <Text style={{ fontSize: 11.5, fontWeight: "semibold", color: fill > width - 48 ? colors.fillInk : colors.muted }}>{words}</Text>
          </View>
        )}
      </View>
      {!disabled && (
        <StepKeys
          testID={testID}
          labels={notches.map((notch) => format?.(notch) ?? String(notch))}
          index={nearestIndex(notches, shown)}
          onStep={(at) => {
            const next = notches[at];
            if (next === undefined || performance.now() - pointerAt.current < CLICK_AFTER_POINTER_MS) return;
            setKeyed({ value: next, over: value });
            onChange?.(next);
            onCommit?.(next);
          }}
          radius={radius}
          ringColor={colors.focus}
        />
      )}
    </View>
  );
}
