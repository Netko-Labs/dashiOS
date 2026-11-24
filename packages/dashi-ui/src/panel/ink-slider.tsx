/**
 * Control Center's flat slider as a setting's slider (docs/design.html,
 * "Settings"): a 40-tall track the color of a hairline, filled with ink
 * from the left, the setting's glyph on a chip at the left and its value at
 * the right (all of it on the ink once the fill reaches its start). Press anywhere to set it,
 * or press and drag; `onChange` hears every move, `onCommit` the value it
 * settled on (the button lifted, or the pointer rested), so a drag is one
 * write to a settings file. Tab reaches it and the arrows step it, as
 * @dashi/ui's slider does (`StepKeys`).
 */

import { type Bounds, Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { DISABLED_OPACITY } from "../control-state.tsx";
import { fillLength, fractionOf, keyValues, levelAt, nearestIndex, type SliderRange, UNIT_RANGE, valueAt } from "../slider-math.ts";
import { StepKeys } from "../step-keys.tsx";
import { SPACE, TYPE, WEIGHT } from "../theme/index.ts";
import { useControlColors } from "./colors.ts";
import { GlyphDisc, InkFill } from "./parts.tsx";

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

/** The value's words: 11.5 SemiBold, their right edge 14 in from the track's end. */
const VALUE = { inset: SPACE.button } as const;

/**
 * Whether the value reads on the ink: once the fill passes where its words
 * start. The whole value takes one colour, never two halves split at the
 * fill's edge ("41 per s|econd", SE-A44). Pure.
 */
export function valueOnInk(fill: number, width: number, words: number): boolean {
  return words > 0 && fill >= width - VALUE.inset - words;
}

/** The value at the slider's right, muted on the track or the ink's own colour once the fill reaches it. */
function Words({ words, width, fill }: { words: string; width: number; fill: number }) {
  const colors = useControlColors();
  const [wide, setWide] = useState(0);
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height: INK_SLIDER.height,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingRight: VALUE.inset,
      }}
    >
      <View testID="ink-slider-value" style={{ flexShrink: 0 }} onLayout={(laid) => setWide((was) => (Math.abs(was - laid.width) < 0.5 ? was : laid.width))}>
        <Text style={{ fontSize: TYPE.panel.detail.size, fontWeight: WEIGHT.semibold, color: valueOnInk(fill, width, wide) ? colors.fillInk : colors.muted }}>
          {words}
        </Text>
      </View>
    </View>
  );
}

const TRACK = { height: INK_SLIDER.height, flexShrink: 0, position: "relative", borderRadius: INK_SLIDER.height / 2 } as const;

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
      style={{ ...TRACK, width, backgroundColor: colors.line, opacity: disabled ? DISABLED_OPACITY : 1 }}
    >
      <InkFill length={fill} total={width} standing={false} radius={radius} />
      {glyph !== undefined && (
        <View style={{ position: "absolute", left: 4, top: 4 }}>
          <GlyphDisc glyph={glyph} />
        </View>
      )}
      {words !== undefined && <Words words={words} width={width} fill={fill} />}
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
