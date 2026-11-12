import { expect, test } from "bun:test";
import { render, TextInput, View } from "@mirinjs/metal";
import { TextSelectionLook } from "../src/selection.tsx";
import { setAppearanceSource } from "../src/theme/appearance.ts";
import { darkColors, lightColors } from "../src/theme/palette.ts";
import { fakeHost } from "./host.ts";
import { settle } from "./support/time.ts";

/** The `selectionColor` each field in the last tree was sent with. */
function selectionColors(tree: string): unknown[] {
  const root = JSON.parse(tree) as { children: Array<{ props: { selectionColor?: unknown } }> };
  return root.children.map((child) => child.props.selectionColor);
}

test("selected text in a field is on the text selection wash, in the live palette", async () => {
  let dark = false;
  const listeners = new Set<() => void>();
  setAppearanceSource({
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isDark: () => dark,
  });
  const host = fakeHost();
  const root = render(
    <TextSelectionLook>
      <View>
        <TextInput value="hello" testID="plain" />
        <TextInput value="hello" testID="own" selectionColor="#ff000033" />
      </View>
    </TextSelectionLook>,
    host.transport,
  );
  await settle();
  expect(selectionColors(host.last())).toEqual([lightColors.textSelection, "#ff000033"]);
  dark = true;
  for (const listener of listeners) listener();
  await settle();
  expect(selectionColors(host.last())).toEqual([darkColors.textSelection, "#ff000033"]);
  root.unmount();
  setAppearanceSource({ subscribe: () => () => {}, isDark: () => false });
});
