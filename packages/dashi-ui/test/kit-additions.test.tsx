// What the launcher needed from the kit (round 2): a toned, larger GlyphButton, keys after a Button's words,
// a Chip with an app's picture, a PopUpButton whose options open in place, and the bare field.
import { expect, test } from "bun:test";
import { View } from "@mirinjs/metal";
import { BareField } from "../src/bare-field.tsx";
import { Button } from "../src/button.tsx";
import { Chip } from "../src/chip.tsx";
import { GLYPH_BUTTON, GlyphButton } from "../src/glyph-button.tsx";
import { SQUARE } from "../src/glyphs.ts";
import { PopUpButton } from "../src/popup-button.tsx";
import { lightColors } from "../src/theme/palette.ts";
import { noop } from "./support/controls-view.ts";
import { fakeClockEachTest } from "./support/time.ts";
import { sent, words } from "./support/tree.ts";

fakeClockEachTest();

test("a toned GlyphButton goes ahead in ink or the agents' shiso; large is 28", async () => {
  const { node, root } = await sent(
    <View>
      <GlyphButton testID="stop" glyph={SQUARE} label="Stop" size="large" tone="primary" onPress={noop} />
      <GlyphButton testID="send" glyph={SQUARE} label="Send" size="large" tone="agent" onPress={noop} />
    </View>,
  );
  expect(node("stop")?.props).toMatchObject({ width: GLYPH_BUTTON.large.target, background: lightColors.primary, access: { label: "Stop" } });
  expect(node("send")?.props.background).toBe(lightColors.agent);
  root.unmount();
});

test("keys follow a Button's words; a Chip shows an app's picture; the bare field has no edge", async () => {
  const { node, root } = await sent(
    <View>
      <Button testID="yes" label="Yes" size="small" primary keys="↩" onPress={noop} />
      <Chip testID="scope" label="Files" size="toolbar" picture="/usr/share/icons/files.png" />
      <BareField testID="field" value="" size={17} placeholder="Search" onChangeText={noop} />
    </View>,
  );
  expect(words(node("yes"))).toContain("Yes");
  expect(node("yes")?.props).toMatchObject({ height: 24 });
  expect((node("yes")?.children ?? []).length).toBe(2);
  expect(JSON.stringify(node("scope"))).toContain("files.png");
  expect(node("field")?.props.borderWidth).toBeUndefined();
  root.unmount();
});

test("a PopUpButton that opens in place calls its owner instead of a menu", async () => {
  let opened = 0;
  const { host, root } = await sent(
    <View>
      <PopUpButton testID="pick" options={[{ value: "a", label: "A" }]} value="a" onChange={noop} opensInPlace={() => opened++} />
    </View>,
  );
  host.emit({ type: "press", nodeId: root.nodeId("pick") ?? "" });
  expect(opened).toBe(1);
  expect(root.nodeId("pick:menu")).toBeUndefined();
  root.unmount();
});
