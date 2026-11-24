import { Group, Note, TextField } from "@dashi/ui";
import { useState } from "react";
import { LayoutPicker } from "../../../settings-app/keyboard.tsx";
import type { SetupContext } from "../context.ts";

/** The layout list Settings has, and a field to type in: the compositor applies a new layout in a moment, to every app. */
export function KeyboardPage({ ctx }: { ctx: SetupContext }) {
  const [typed, setTyped] = useState("");
  return (
    <>
      <TextField testID="setup-keyboard-test" value={typed} placeholder="Type here to try your keyboard" onChangeText={setTyped} />
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
