import { Group, Note, useColors, useSurface } from "@dashi/ui";
import { TextInput, View } from "@mirinjs/metal";
import { useState } from "react";
import { LayoutPicker } from "../../../settings-app/panes/keyboard.tsx";
import type { SetupContext } from "../context.ts";

/** The layout list Settings has, and a field to type in: the compositor applies a new layout in a moment, to every app. */
export function KeyboardPage({ ctx }: { ctx: SetupContext }) {
  const colors = useColors();
  const surface = useSurface();
  const [typed, setTyped] = useState("");
  return (
    <>
      <View
        style={{
          flexShrink: 0,
          height: 34,
          justifyContent: "center",
          paddingHorizontal: 10,
          borderRadius: 8,
          backgroundColor: surface.card,
          borderWidth: 1,
          borderColor: colors.separator,
        }}
      >
        <TextInput
          testID="setup-keyboard-test"
          value={typed}
          placeholder="Type here to try your keyboard"
          onChangeText={setTyped}
          style={{ fontSize: 13, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
        />
      </View>
      <Group>
        {ctx.layouts.layouts.length === 0 ? (
          <Note testID="setup-no-layouts">The list of layouts is not installed on this system. You can set one later in System Settings.</Note>
        ) : (
          <LayoutPicker layouts={ctx.layouts} settings={ctx.settings} />
        )}
      </Group>
    </>
  );
}
