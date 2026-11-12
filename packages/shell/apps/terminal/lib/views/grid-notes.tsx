/** What the terminal says over its grid: its size while the window is resized, and that the shell stopped. */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";

/** The lost-shell notice's distance from the window's sides. */
const NOTICE_INSET = 12;

/** The grid's size in columns and rows, in the middle, while it changes. */
export function SizeNote({ size }: { size: string }) {
  const colors = useColors();
  return (
    <View testID="terminal-size" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7, backgroundColor: colors.menu, borderWidth: 1, borderColor: colors.separator }}>
        <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>{size}</Text>
      </View>
    </View>
  );
}

export function LostNote() {
  const colors = useColors();
  return (
    <View testID="terminal-lost" style={{ position: "absolute", left: NOTICE_INSET, right: NOTICE_INSET, bottom: 24, alignItems: "center" }}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: colors.menu, borderWidth: 1, borderColor: colors.separator }}>
        <Text style={{ fontSize: 13, color: colors.text, textAlign: "center" }}>The shell stopped. Press Return to restart.</Text>
      </View>
    </View>
  );
}
