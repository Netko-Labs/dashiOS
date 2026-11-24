/** What the terminal says about its grid: its size while the window is resized, and that the shell stopped. */

import { Button, Notice, pill, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";

/** The size pill's measures: a chip's height, so it is a pill (half its height). */
const SIZE_PILL = { height: 24, inset: SPACE.gap } as const;

/** The grid's size in columns and rows, in the middle, while it changes: a pill on the menu's ground. */
export function SizeNote({ size }: { size: string }) {
  const colors = useColors();
  return (
    <View testID="terminal-size" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          height: SIZE_PILL.height,
          paddingHorizontal: SIZE_PILL.inset,
          justifyContent: "center",
          borderRadius: pill(SIZE_PILL.height),
          backgroundColor: colors.menu,
          borderWidth: SPACE.px,
          borderColor: colors.separator,
        }}
      >
        <Text style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{size}</Text>
      </View>
    </View>
  );
}

/** The front tab's shell stopped: the window's notice (VS-3), with Restart; Return in the grid restarts too. */
export function LostNotice({ onRestart }: { onRestart: () => void }) {
  return (
    <Notice
      testID="terminal-lost"
      text="The shell stopped."
      action={<Button testID="terminal-lost:restart" label="Restart" size="small" onPress={onRestart} />}
    />
  );
}
