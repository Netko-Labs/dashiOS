/**
 * An on/off switch, macOS style: a pill that takes the accent color when on,
 * with its knob at the end. Settings, Control Center's pages, and the
 * launcher's rows (a setting with state) all draw this one.
 */

import { View } from "@mirinjs/metal";
import { useColors } from "./theme/index.ts";

export interface SwitchProps {
  on: boolean;
  testID: string;
  /** Without it the switch only shows its state (a launcher row, where Space flips it). */
  onChange?: (on: boolean) => void;
}

export function Switch({ on, testID, onChange }: SwitchProps) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      {...(onChange ? { onPress: () => onChange(!on) } : {})}
      style={{
        width: 38,
        height: 22,
        padding: 2,
        borderRadius: 11,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: on ? "flex-end" : "flex-start",
        backgroundColor: on ? colors.selection : colors.track,
      }}
    >
      <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: "#ffffff", shadow: "sm" }} />
    </View>
  );
}
