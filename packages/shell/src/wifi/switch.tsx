/** An on/off switch, macOS style: a pill that takes the accent color when on, with its knob at the end. */

import { useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";

export function Switch({ on, testID, onChange }: { on: boolean; testID: string; onChange: (on: boolean) => void }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={() => onChange(!on)}
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
