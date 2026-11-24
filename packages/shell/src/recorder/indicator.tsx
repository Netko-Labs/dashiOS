/**
 * The menu bar while Dashi records the screen: a stop button with the time
 * recorded, as on the Mac. It stands in for the "Screen is being shared"
 * pill while the capture is the recorder's own (screen-capture.tsx).
 */

import { pill, RADIUS, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { elapsedText } from "../shared/time/index.ts";
import { type ScreenRecorder, useRecorder } from "./recorder.ts";

/** The stop pill's height, in the bar's row. */
const STOP_PILL = 20;

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
  return (
    <View
      testID="recording-stop"
      onPress={() => void recorder.stop()}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.s,
        height: STOP_PILL,
        paddingLeft: SPACE.m,
        paddingRight: SPACE.m,
        borderRadius: pill(STOP_PILL),
        backgroundColor: colors.captureWash,
      }}
    >
      <View style={{ width: 9, height: 9, borderRadius: RADIUS.thumb, backgroundColor: colors.critical }} />
      <Text style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
        {state.kind === "saving" ? "Saving…" : elapsedText(now - state.since)}
      </Text>
    </View>
  );
}
