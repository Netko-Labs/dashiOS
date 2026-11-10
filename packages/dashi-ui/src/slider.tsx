/**
 * The slider, in its two looks: a setting's (a thin kombu track and a white
 * knob: Settings' rows, `dashi-dialog --scale`), and with a `glyph`, Control
 * Center's (a tall bar whose white fill carries the glyph, as on the Mac).
 * Press anywhere on the bar to set it, or press and drag: Metal keeps sending
 * the pointer to the bar until the button lifts, even outside the window.
 *
 * While the pointer holds it, it shows the pointer's value. `onChange` hears
 * every move (a level that follows the drag: volume, brightness);
 * `onCommit` hears the value once, when the button lifts or the pointer
 * rests, so a drag is one write to a settings file.
 *
 * Tab reaches it (the ring goes round the bar), and the arrows step it:
 * every step when there are few, else about 5% a press (`keyValues`). Each
 * press is both a move and a commit.
 */

import { type Bounds, Svg, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { useControlState } from "./control-state.tsx";
import { fractionAt, fractionOf, keyValues, knobLeft, nearestIndex, type SliderRange, UNIT_RANGE, valueAt } from "./slider-math.ts";
import { StepKeys } from "./step-keys.tsx";
import { lightColors, useColors } from "./theme/index.ts";

/** A setting's slider: the knob, and the track it runs on. */
const KNOB = 18;
const TRACK = 4;
/** Control Center's: the bar is as tall as its round end. */
const BAR = 28;
/** A drag that stops moving for this long is committed, in case the release never arrives. */
const SETTLE_MS = 300;
/** A press on the bar's key stop this soon after the pointer let go is the click that ended a drag, not a key. */
const CLICK_AFTER_POINTER_MS = 300;

export interface SliderProps {
  value: number;
  /** Where it runs and how it snaps; 0 to 1, unsnapped, by default. */
  range?: SliderRange;
  /** The bar's width; the layout fixes it. */
  width?: number;
  testID: string;
  /** Every value the pointer passes. */
  onChange?: (value: number) => void;
  /** The value it settled on: the button lifted, or the pointer rested. */
  onCommit?: (value: number) => void;
  /** Control Center's look: a tall bar with this glyph in its fill. */
  glyph?: string;
  disabled?: boolean;
  /** Keyboard focus is on it (`data-focused`, the gallery's state rows); real keyboard focus is Metal's ring (KB-2). */
  focused?: boolean;
}

/** A setting's bar: the thin track, the filled part of it, and the white knob. */
function PlainBar({ height, width, left }: { height: number; width: number; left: number }) {
  const colors = useColors();
  return (
    <>
      <View
        style={{ position: "absolute", left: 0, top: (height - TRACK) / 2, width, height: TRACK, borderRadius: TRACK / 2, backgroundColor: colors.track }}
      />
      <View
        style={{
          position: "absolute",
          left: 0,
          top: (height - TRACK) / 2,
          width: left + KNOB / 2,
          height: TRACK,
          borderRadius: TRACK / 2,
          backgroundColor: colors.selection,
        }}
      />
      <View style={{ position: "absolute", left, top: 2, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: "#ffffff", shadow: "sm" }} />
    </>
  );
}

/** Control Center's bar: a tall track whose white fill carries the glyph. */
function GlyphBar({ glyph, width, left }: { glyph: string; width: number; left: number }) {
  const colors = useColors();
  return (
    <View style={{ width, height: BAR, borderRadius: BAR / 2, backgroundColor: colors.track, overflow: "hidden" }}>
      <View
        style={{
          width: left + BAR,
          height: BAR,
          borderRadius: BAR / 2,
          backgroundColor: "#ffffff",
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 7,
        }}
      >
        {/* Ink on the white fill in both modes. */}
        <Svg markup={glyph} size={14} color={lightColors.text} />
      </View>
    </View>
  );
}

export function Slider({ value, range = UNIT_RANGE, width = 220, testID, onChange, onCommit, glyph, disabled, focused }: SliderProps) {
  const colors = useColors();
  const state = useControlState({ disabled, focused });
  const [dragging, setDragging] = useState<number | null>(null);
  // The value an arrow set, shown until the owner's value changes (a level read back from a device comes later).
  const [keyed, setKeyed] = useState<{ value: number; over: number } | null>(null);
  const pointerAt = useRef(0);
  // Pointer events carry the bar's bounds; the last layout stands in for one that does not.
  const laid = useRef<Bounds | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pending.current), []);

  const knob = glyph === undefined ? KNOB : BAR;
  const commit = (next: number): void => {
    clearTimeout(pending.current);
    setDragging(null);
    onCommit?.(next);
  };
  const shown = dragging ?? (keyed !== null && keyed.over === value ? keyed.value : value);
  const fraction = fractionOf(shown, range);
  const notches = keyValues(range);
  const left = knobLeft(fraction, width, knob);
  const height = glyph === undefined ? KNOB + 4 : BAR;
  return (
    <View
      testID={testID}
      data-focused={state.focused}
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
              const next = valueAt(fractionAt(event.x, bar, knob), range);
              setDragging(next);
              onChange?.(next);
              clearTimeout(pending.current);
              if (event.phase === "up") commit(next);
              else if (onCommit) pending.current = setTimeout(() => commit(next), SETTLE_MS);
            }
      }
      style={{ width, height, position: "relative", opacity: state.opacity }}
    >
      {glyph === undefined ? <PlainBar height={height} width={width} left={left} /> : <GlyphBar glyph={glyph} width={width} left={left} />}
      {!disabled && (
        <StepKeys
          testID={testID}
          labels={notches.map(String)}
          index={nearestIndex(notches, shown)}
          onStep={(at) => {
            const next = notches[at];
            if (next === undefined || performance.now() - pointerAt.current < CLICK_AFTER_POINTER_MS) return;
            setKeyed({ value: next, over: value });
            onChange?.(next);
            onCommit?.(next);
          }}
          radius={height / 2}
          ringColor={colors.focusRing}
        />
      )}
    </View>
  );
}
