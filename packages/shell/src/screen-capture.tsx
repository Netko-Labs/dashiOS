/**
 * The menu bar's privacy indicator: a red dot and "Screen is being shared"
 * for as long as the compositor reports a capture (screen-capture.ts), unless
 * it is Dashi's own recording, which shows its stop button instead.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import type { ScreenRecorder } from "./recorder/index.ts";
import { type ScreenCaptureStore, useScreenCapture } from "./screen-capture.ts";

const IDLE = () => false;
const NEVER = () => () => {};

/** Whether `recorder` is recording, so the pill gives way to its stop button (recorder/indicator.tsx). */
function useRecording(recorder: ScreenRecorder | undefined): boolean {
  return useSyncExternalStore(recorder?.subscribe ?? NEVER, recorder ? () => recorder.ownsCapture() : IDLE);
}

export function CapturePill({ store, recorder }: { store: ScreenCaptureStore; recorder?: ScreenRecorder }) {
  const colors = useColors();
  const capturing = useScreenCapture(store);
  const recording = useRecording(recorder);
  if (!capturing || recording) return null;
  return (
    <View
      testID="capture-pill"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 20,
        paddingLeft: 8,
        paddingRight: 9,
        borderRadius: 10,
        backgroundColor: colors.captureWash,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.critical }} />
      <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>Screen is being shared</Text>
    </View>
  );
}
