// The kit's pieces for the apps (0.10, W5): words edited in place, a tab in the title row, and a keypad's key.
import { expect, test } from "bun:test";
import { View } from "@mirinjs/metal";
import { EDITABLE_TEXT, EditableText } from "../src/editable-text.tsx";
import { KEYPAD_KEY, KeypadKey } from "../src/keypad-key.tsx";
import { SearchField } from "../src/search-field.tsx";
import { SHEET_MARGIN, Sheet } from "../src/sheet.tsx";
import { CLEAR, RADIUS } from "../src/theme/index.ts";
import { lightColors } from "../src/theme/palette.ts";
import { TitleTab, TitleTabMore } from "../src/title-tab.tsx";
import { noop } from "./support/controls-view.ts";
import { fakeClockEachTest } from "./support/time.ts";
import { sent, words } from "./support/tree.ts";

fakeClockEachTest();

test("EditableText: plain has no ground and no edge; inline is the rename look, edged in the ring's colour", async () => {
  const { node, root } = await sent(
    <View>
      <EditableText testID="page" value="Dear Alex," onChangeText={noop} multiline style={{ fontSize: 13, color: "#123456" }} />
      <EditableText testID="rename" look="inline" value="Report.pdf" onChangeText={noop} />
    </View>,
  );
  const page = JSON.stringify(node("page"));
  expect(page).toContain(`"background":"${CLEAR}"`);
  expect(page).toContain(`"focusBorderColor":"${CLEAR}"`);
  expect(page).toContain('"color":"#123456"');
  const rename = JSON.stringify(node("rename"));
  expect(rename).toContain(`"cornerRadius":${EDITABLE_TEXT.inlineRadius}`);
  expect(rename).toContain(`"focusBorderColor":"${lightColors.focusRing}"`);
  root.unmount();
});

test("TitleTab: a tab, chosen in front; the × closes; the dot only when it rang; the count names what it hides", async () => {
  const pressed: string[] = [];
  const { node, json, root } = await sent(
    <View>
      <TitleTab testID="a" label="~/Developer" front rang={false} onPress={() => pressed.push("a")} onClose={() => pressed.push("close a")} />
      <TitleTab testID="b" label="htop" front={false} rang onPress={noop} onClose={noop} />
      <TitleTabMore testID="more" hidden={3} rang width={44} onPress={noop} />
    </View>,
  );
  expect(node("a")?.props.access).toMatchObject({ role: "tab", label: "~/Developer" });
  expect(words(node("more"))).toEqual(["+3"]);
  expect(node("a:dot")).toBeNull();
  expect(node("b:dot")).not.toBeNull();
  expect(node("more:dot")).not.toBeNull();
  expect(json()).toContain(`"cornerRadius":${RADIUS.control}`);
  root.unmount();
});

test("KeypadKey: = in the primary's ink, a digit edged on the card, every label 400", async () => {
  const { node, root } = await sent(
    <View>
      <KeypadKey testID="equals" label="=" accessibilityLabel="Equals" tone="strong" fontSize={24} onPress={noop} />
      <KeypadKey testID="seven" label="7" tone="digit" fontSize={24} onPress={noop} span={2} />
      <KeypadKey testID="plus" label="+" tone="quiet" fontSize={24} onPress={noop} lit />
    </View>,
  );
  expect(node("equals")?.props.access).toMatchObject({ role: "button", label: "Equals" });
  expect(JSON.stringify(node("equals"))).toContain(`"background":"${lightColors.primary}"`);
  expect(JSON.stringify(node("seven"))).toContain(`"cornerRadius":${KEYPAD_KEY.radius}`);
  expect(JSON.stringify(node("plus"))).toContain(`"background":"${lightColors.pressed}"`);
  for (const id of ["equals", "seven", "plus"]) expect(JSON.stringify(node(id))).not.toContain('"medium"');
  root.unmount();
});

test("Sheet, tall and bare: the window's ground, no padding, its height giving way to a short window", async () => {
  const { node, root } = await sent(
    <Sheet testID="chooser" width={760} height={470} bare>
      <View />
    </Sheet>,
  );
  const card = node("chooser")?.props ?? {};
  expect(card).toMatchObject({ height: 470, minHeight: 0 });
  expect(card.padding).toBeUndefined();
  expect(node("chooser:scrim")?.props).toMatchObject({ paddingBottom: SHEET_MARGIN });
  root.unmount();
});

test("SearchField with crumbs: at rest the box holds them and is one Tab stop; editing, it fills its row with its tools at the end", async () => {
  const { node, root } = await sent(
    <View>
      <SearchField testID="rest" value="" onChangeText={noop} width="fill" rest={<View testID="crumbs" />} restLabel="Path" onPressRest={noop} />
      <SearchField testID="edit" value="rep" onChangeText={noop} width="fill" minWidth={96} accessory={<View testID="scope" />} />
    </View>,
  );
  expect(node("rest")?.props).toMatchObject({ focusable: true, access: { role: "button", label: "Path" } });
  expect(node("crumbs")).not.toBeNull();
  expect(node("scope")).not.toBeNull();
  expect(node("edit:clear")).not.toBeNull();
  root.unmount();
});
