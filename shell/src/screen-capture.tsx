/**
 * The menu bar's privacy indicator: a red dot and "Screen is being shared"
 * for as long as the compositor reports a capture (screen-capture.ts).
 */

import { Text, View } from "@mirinjs/metal";
import { type ScreenCaptureStore, useScreenCapture } from "./screen-capture.ts";
import { useColors } from "./theme.ts";

export function CapturePill({ store }: { store: ScreenCaptureStore }) {
  const colors = useColors();
  if (!useScreenCapture(store)) return null;
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
