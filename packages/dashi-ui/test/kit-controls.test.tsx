// The kit's controls (UI-8 to UI-12): each named for screen readers, focusable while it can be used,
// pressed and disabled drawn, in the window look and the panel look, on the one "on".
import { expect, test } from "bun:test";
import { View } from "@mirinjs/metal";
import { Button } from "../src/button.tsx";
import { CHECKBOX, Checkbox } from "../src/checkbox.tsx";
import { CHIP, Chip } from "../src/chip.tsx";
import { ShowStates } from "../src/control-state.tsx";
import { GLYPH_BUTTON, GlyphButton } from "../src/glyph-button.tsx";
import { CLOSE, SEARCH } from "../src/glyphs.ts";
import { placeholderAt, SEARCH_FIELD, SearchField } from "../src/search-field.tsx";
import { SEGMENTED, Segmented } from "../src/segmented.tsx";
import { INKS_SWITCH, PANEL_SWITCH, Switch } from "../src/switch.tsx";
import { TextField } from "../src/text-field.tsx";
import { TextLink } from "../src/text-link.tsx";
import { LIGHT_CONTROLS } from "../src/theme/controls.ts";
import { INK_PAPER, INK_TEXT } from "../src/theme/inks.ts";
import { lightColors } from "../src/theme/palette.ts";
import { noop } from "./support/controls-view.ts";
import { fakeClockEachTest } from "./support/time.ts";
import { sent, words } from "./support/tree.ts";

fakeClockEachTest();

test("Button: 28, a small 24 in 12 SemiBold, fill takes the row; the panel look is a pill", async () => {
  const { node, root } = await sent(
    <View>
      <Button testID="regular" label="Save" primary onPress={noop} />
      <Button testID="small" label="Clear all" size="small" onPress={noop} />
      <Button testID="fill" label="Continue" fill onPress={noop} />
      <Button testID="pill" label="Edit" look="panel" primary onPress={noop} />
      <Button testID="pill-small" label="Join" look="panel" size="small" onPress={noop} />
      <Button testID="off" label="Delete" danger disabled onPress={noop} />
    </View>,
  );
  expect(node("regular")?.props).toMatchObject({ height: 28, cornerRadius: 7, focusable: true, access: { role: "button", label: "Save" } });
  expect(node("small")?.props).toMatchObject({ height: 24 });
  expect(node("fill")?.props.flex).toBe(1);
  expect(node("pill")?.props).toMatchObject({ height: 36, cornerRadius: 18, background: LIGHT_CONTROLS.text });
  expect(node("pill-small")?.props).toMatchObject({ height: 28, cornerRadius: 14 });
  // Disabled: dimmed whole, never a Tab stop, and still ume.
  expect(node("off")?.props).toMatchObject({ opacity: 0.4, background: lightColors.umeFill });
  expect(node("off")?.props.focusable).toBeUndefined();
  root.unmount();
});

test("Button: the inks look is a 28 pill on the Inks' paper with ink words; never the accent", async () => {
  const { node, root } = await sent(
    <View>
      <Button testID="inks" label="Edit widgets" look="inks" onPress={noop} />
      <Button testID="inks-ink" label="Done" look="inks" primary onPress={noop} />
    </View>,
  );
  expect(node("inks")?.props).toMatchObject({ height: 28, cornerRadius: 14, background: INK_PAPER.light, borderColor: INK_TEXT.light.hairline });
  expect(node("inks")?.props).toMatchObject({ focusable: true, access: { role: "button", label: "Edit widgets" } });
  expect(node("inks-ink")?.props.background).toBe(INK_TEXT.light.ink);
  root.unmount();
});

test("Switch: the panel look is 46 × 28, its off track an outline; on is the one on in both looks", async () => {
  const { node, root } = await sent(
    <View>
      <Switch testID="window" on label="Wi-Fi" onChange={noop} />
      <Switch testID="panel-on" look="panel" on label="Bluetooth" onChange={noop} />
      <Switch testID="panel-off" look="panel" on={false} label="Night Shift" onChange={noop} />
    </View>,
  );
  expect(node("window")?.props).toMatchObject({ background: lightColors.selection, access: { role: "switch", label: "Wi-Fi", checked: true } });
  expect(node("panel-on")?.props).toMatchObject({ width: PANEL_SWITCH.width, height: PANEL_SWITCH.height, background: lightColors.selection });
  expect(node("panel-off")?.props).toMatchObject({ borderWidth: PANEL_SWITCH.edge, borderColor: LIGHT_CONTROLS.muted });
  root.unmount();
});

test("Switch: the inks look is the widget area's, 36 × 20 in the Inks' ink, never the accent", async () => {
  const { node, root } = await sent(
    <View>
      <Switch testID="inks-on" look="inks" on label="May go on air" onChange={noop} />
      <Switch testID="inks-off" look="inks" on={false} label="May go on air" onChange={noop} />
    </View>,
  );
  expect(node("inks-on")?.props).toMatchObject({ width: INKS_SWITCH.width, height: INKS_SWITCH.height, background: INK_TEXT.light.ink });
  expect(node("inks-on")?.props).toMatchObject({ access: { role: "switch", label: "May go on air", checked: true }, focusable: true });
  expect(node("inks-off")?.props.background).toBe(INK_TEXT.light.hairline);
  expect(node("inks-on")?.props.background).not.toBe(lightColors.selection);
  expect(INK_PAPER.light).toBeDefined();
  root.unmount();
});

test("GlyphButton: round, named for screen readers, a Tab stop; filled shows a disc; disabled is dimmed and takes no press", async () => {
  let pressed = 0;
  const { node, host, root } = await sent(
    <View>
      <GlyphButton testID="close" glyph={CLOSE} label="Remove" onPress={() => pressed++} />
      <GlyphButton testID="filled" glyph={CLOSE} label="Remove" size="small" filled onPress={noop} />
      <GlyphButton testID="off" glyph={CLOSE} label="Remove" disabled onPress={() => pressed++} />
    </View>,
  );
  expect(node("close")?.props).toMatchObject({ width: GLYPH_BUTTON.regular.target, cornerRadius: GLYPH_BUTTON.regular.target / 2, focusable: true });
  expect(node("close")?.props).toMatchObject({ access: { role: "button", label: "Remove" } });
  expect(node("filled")?.props).toMatchObject({ width: GLYPH_BUTTON.small.target, background: lightColors.track });
  expect(node("off")?.props).toMatchObject({ opacity: 0.4 });
  expect(node("off")?.props.focusable).toBeUndefined();
  host.emit({ type: "press", nodeId: root.nodeId("close") ?? "" });
  host.emit({ type: "press", nodeId: root.nodeId("off") ?? "" });
  expect(pressed).toBe(1);
  root.unmount();
});

test("Checkbox: a 16 box, off an edge on the field, on the one on with its tick; pressed deepens; a press toggles", async () => {
  const changes: boolean[] = [];
  const { node, host, root } = await sent(
    <View>
      <Checkbox testID="off" label="Remember" checked={false} onChange={(on) => changes.push(on)} />
      <Checkbox testID="on" label="Remember" checked onChange={noop} />
      <ShowStates pressed>
        <Checkbox testID="held" label="Remember" checked onChange={noop} />
      </ShowStates>
      <Checkbox testID="disabled" label="Remember" checked={false} disabled onChange={noop} />
    </View>,
  );
  expect(node("off")?.props).toMatchObject({ focusable: true, access: { role: "checkbox", label: "Remember", checked: false } });
  expect(node("off:box")?.props).toMatchObject({ width: CHECKBOX.box, cornerRadius: 4, borderWidth: CHECKBOX.edge, borderColor: lightColors.controlEdge });
  expect(node("on:box")?.props.background).toBe(lightColors.selection);
  expect(node("held:box")?.props.background).toBe(lightColors.selectionPressed);
  expect(node("disabled")?.props).toMatchObject({ opacity: 0.4 });
  host.emit({ type: "press", nodeId: root.nodeId("off") ?? "" });
  expect(changes).toEqual([true]);
  root.unmount();
});

test("Chip: 18 tall, a pill, 11 SemiBold on its tone's wash; the toolbar's is 24", async () => {
  const { node, root } = await sent(
    <View>
      <Chip testID="agent" label="Connected" tone="agent" />
      <Chip testID="bar" label="Offline" tone="warning" size="toolbar" />
    </View>,
  );
  expect(node("agent")?.props).toMatchObject({ height: CHIP.height, cornerRadius: 9, background: lightColors.agentWash });
  expect(words(node("agent"))).toEqual(["Connected"]);
  expect(node("bar")?.props).toMatchObject({ height: CHIP.toolbarHeight, background: lightColors.brothWash });
  root.unmount();
});

test("Segmented: glyph segments carry a name; the chosen one is raised with shadow sm; the panel look's pills wear on", async () => {
  const views = [
    { value: "grid", label: "Icons", glyph: SEARCH },
    { value: "list", label: "List", glyph: SEARCH },
  ];
  const { node, root } = await sent(
    <View>
      <Segmented testID="view" options={views} value="list" onChange={noop} />
      <Segmented
        testID="size"
        look="panel"
        options={[
          { value: 1, label: "Small" },
          { value: 2, label: "Large" },
        ]}
        value={2}
        onChange={noop}
      />
    </View>,
  );
  expect(node("view:grid")?.props).toMatchObject({ access: { role: "tab", label: "Icons", selected: false } });
  expect(node("view:list")?.props).toMatchObject({ shadow: "sm" });
  expect(node("size:2")?.props).toMatchObject({ height: SEGMENTED.height, background: lightColors.selection });
  root.unmount();
});

test("TextField: a glyph keeps its text clear, a wrong value is ume, and the line under it says why", async () => {
  const { node, root } = await sent(
    <View>
      <TextField testID="name" value="" label="Name" glyph={SEARCH} onChangeText={noop} />
      <TextField testID="code" value="12" invalid message="Six digits." onChangeText={noop} />
      <TextField testID="off" value="alexk" disabled onChangeText={noop} />
    </View>,
  );
  expect(node("name")?.props).toMatchObject({
    height: 28,
    cornerRadius: 7,
    paddingLeft: 29,
    focusBorderColor: lightColors.focusRing,
    access: { label: "Name" },
  });
  expect(node("code")?.props).toMatchObject({ borderColor: lightColors.critical, focusBorderColor: lightColors.critical });
  expect(words(node("code:message"))).toEqual(["Six digits."]);
  expect(node("off:frame")?.props.opacity).toBe(0.4);
  expect(words(node("off"))).toEqual(["alexk"]);
  root.unmount();
});

test("SearchField: 210 by default; its placeholder says Search once shrunk under 140, and never in the field's own text", async () => {
  expect(placeholderAt("Search apps and add-ons", 0)).toBe("Search apps and add-ons");
  expect(placeholderAt("Search apps and add-ons", 210)).toBe("Search apps and add-ons");
  expect(placeholderAt("Search apps and add-ons", 120)).toBe("Search");
  const { node, root } = await sent(<SearchField testID="search" value="" placeholder="Search apps" onChangeText={noop} />);
  expect(JSON.stringify(node("search"))).not.toContain("placeholder");
  expect(words(node("search:placeholder"))).toEqual(["Search apps"]);
  expect(SEARCH_FIELD).toMatchObject({ width: 210, least: 96 });
  root.unmount();
});

test("TextLink: ink and underlined, a link for screen readers (Q3)", async () => {
  const { json, node, root } = await sent(<TextLink testID="other" label="Other…" onPress={noop} />);
  expect(node("other")?.props).toMatchObject({ focusable: true, access: { role: "link", label: "Other…" } });
  expect(json()).toContain('"underline"');
  expect(json()).not.toContain(lightColors.accentInk);
  root.unmount();
});
