/** Editing's one bar, at the bottom (round five, #26): Add · Done. */

import { Svg, Text, View } from "@mirinjs/metal";
import { glyph } from "../shared/inks/index.ts";
import { useWidgetEnv } from "./env.tsx";
import { COLUMN_WIDTH } from "./layout.ts";

export function EditBar({ onAdd, onDone }: { onAdd: () => void; onDone: () => void }) {
  const { inks } = useWidgetEnv();
  const button = (label: string, run: () => void, fill: boolean) => (
    <View
      testID={`edit-${label.toLowerCase()}`}
      onPress={run}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 28,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 14,
        backgroundColor: fill ? inks.text.ink : "#00000000",
      }}
    >
      {fill ? null : <Svg markup={glyph("plus")} size={11} color={inks.text.ink} />}
      <Text style={{ fontSize: 12, fontWeight: "semibold", color: fill ? inks.paper : inks.text.ink }}>{label}</Text>
    </View>
  );
  return (
    <View style={{ width: COLUMN_WIDTH, alignItems: "center" }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          padding: 3,
          borderRadius: 17,
          backgroundColor: inks.paper,
          borderWidth: 1,
          borderColor: inks.text.hairline,
        }}
      >
        {button("Add", onAdd, false)}
        {button("Done", onDone, true)}
      </View>
    </View>
  );
}
