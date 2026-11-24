/**
 * The menu bar while Dashi records the screen: a bar item (UI-18) with the
 * time recorded that stops it, as on the Mac. It stands in for the "Screen is being shared"
 * pill while the capture is the recorder's own (screen-capture.tsx).
 */

import { BarItem, SQUARE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Svg, Text } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { elapsedText } from "../shared/time/index.ts";
import { type ScreenRecorder, useRecorder } from "./recorder.ts";

/** The stop square's size: a glyph on the bar item (UI-18). */
const STOP_SQUARE = 12;

export function RecordingButton({ recorder }: { recorder: ScreenRecorder }) {
  const colors = useColors();
  const state = useRecorder(recorder);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state.kind !== "recording") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.kind]);
  if (state.kind !== "recording" && state.kind !== "saving") return null;
  const words = state.kind === "recording" ? elapsedText(now - state.since) : "";
  return (
    <BarItem
      testID="recording-stop"
      tone="capture"
      label={state.kind === "saving" ? "Saving the recording" : `Recording, ${words}. Stop`}
      onPress={() => void recorder.stop()}
    >
      <Svg markup={SQUARE} size={STOP_SQUARE} color={colors.critical} />
      <Text style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{state.kind === "saving" ? "Saving…" : words}</Text>
    </BarItem>
  );
}
