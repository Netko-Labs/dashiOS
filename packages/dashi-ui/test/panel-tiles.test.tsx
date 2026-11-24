// Control Center's tiles in the kit (UI-1, CC-1): each named for screen readers with its state; on wears
// the one on; the battery's bar is ink, a reading, never on; a dimmed tile is an applet's not running.
import { expect, test } from "bun:test";
import { View } from "@mirinjs/metal";
import { SEARCH } from "../src/glyphs.ts";
import { KNOB_BUTTON, KnobButton } from "../src/panel/knob-button.tsx";
import { BatteryTile, RoundTile, SliderTile, TILE, WideTile } from "../src/panel/tiles.tsx";
import { Switch } from "../src/switch.tsx";
import { LIGHT_CONTROLS } from "../src/theme/controls.ts";
import { noop } from "./support/controls-view.ts";
import { fakeClockEachTest } from "./support/time.ts";
import { sent, words } from "./support/tree.ts";

fakeClockEachTest();

const look = (testID: string, on: boolean, dim = false) => ({ testID, title: "Wi-Fi", detail: "Home", glyph: SEARCH, on, dim });

test("a wide tile: a switch when its knob toggles, on in the one on, its knob a switch of its own", async () => {
  const { node, root } = await sent(
    <View>
      <WideTile look={look("wide-on", true)} onToggle={noop} onOpen={noop} />
      <WideTile look={look("wide-off", false)} onToggle={noop} />
    </View>,
  );
  expect(node("wide-on")?.props).toMatchObject({ background: LIGHT_CONTROLS.on, access: { role: "button", label: "Wi-Fi" } });
  expect(node("wide-on-knob")?.props).toMatchObject({ access: { role: "switch", label: "Wi-Fi", checked: true } });
  expect(node("wide-off")?.props).toMatchObject({ background: LIGHT_CONTROLS.off, access: { role: "switch", checked: false } });
  expect(node("wide-off-knob")?.props).toMatchObject({ width: TILE.knob, cornerRadius: TILE.knob / 2 });
  expect(words(node("wide-on"))).toEqual(["Wi-Fi", "Home"]);
  root.unmount();
});

test("a round tile is a switch; a dimmed one is half there", async () => {
  const { node, root } = await sent(
    <View>
      <RoundTile look={look("round", false)} onToggle={noop} />
      <RoundTile look={look("dim", true, true)} onToggle={noop} />
    </View>,
  );
  expect(node("round")?.props).toMatchObject({ cornerRadius: TILE.radius.off, access: { role: "switch", label: "Wi-Fi", checked: false } });
  expect(node("dim")?.props).toMatchObject({ opacity: 0.5, background: LIGHT_CONTROLS.on });
  root.unmount();
});

test("a slider tile names its level; the battery tile is a button that says its charge and time", async () => {
  const { node, root } = await sent(
    <View>
      <SliderTile look={{ testID: "volume", title: "Sound", glyph: SEARCH, level: 0.5, value: "50%", width: 74, height: 176 }} standing onLevel={noop} />
      <BatteryTile look={{ percent: 64, charging: false, limit: 80, time: "5 h", glyph: SEARCH }} onOpen={noop} />
    </View>,
  );
  expect(node("volume")?.props).toMatchObject({ access: { role: "group", label: "Sound, 50%" } });
  expect(node("cc-battery")?.props).toMatchObject({ access: { role: "button", label: "Battery 64%, 5 h" } });
  expect(words(node("cc-battery"))).toContain("64%");
  root.unmount();
});

test("a knob button: a named button, a switch while it says checked (inked then), lit on a lit tile", async () => {
  const { node, root } = await sent(
    <View>
      <KnobButton testID="back" glyph={SEARCH} label="Back" onPress={noop} />
      <KnobButton testID="mute" glyph={SEARCH} label="Mute Helium" checked onPress={noop} />
      <KnobButton testID="lit" glyph={SEARCH} label="Back" lit focusable={false} onPress={noop} />
    </View>,
  );
  expect(node("back")?.props).toMatchObject({
    width: KNOB_BUTTON.size,
    cornerRadius: KNOB_BUTTON.size / 2,
    focusable: true,
    access: { role: "button", label: "Back" },
  });
  expect(node("back")?.props.background).toBe(LIGHT_CONTROLS.knobOff);
  expect(node("mute")?.props).toMatchObject({ background: LIGHT_CONTROLS.fill, access: { role: "switch", label: "Mute Helium", checked: true } });
  expect(node("lit")?.props.background).toBe(LIGHT_CONTROLS.knobOn);
  expect(node("lit")?.props.focusable).toBeUndefined();
  root.unmount();
});

test("a panel switch on a lit tile: on, its track the on ink under a knob in the on colour", async () => {
  const { node, root } = await sent(<Switch testID="lit" look="panel" lit on label="Wi-Fi" onChange={noop} />);
  expect(node("lit")?.props).toMatchObject({ background: LIGHT_CONTROLS.onInk, access: { role: "switch", checked: true } });
  root.unmount();
});

test("a lying slider tile less tall than the panel's corner is a pill, and takes a lead in its glyph's place", async () => {
  const { node, root } = await sent(
    <View>
      <SliderTile
        look={{ testID: "app", title: "Helium", glyph: SEARCH, level: 0.3, value: "30%", width: 266, height: 48 }}
        standing={false}
        onLevel={noop}
        lead={<View testID="lead" />}
      />
    </View>,
  );
  expect(node("app")?.props.cornerRadius).toBe(24);
  expect(node("lead")).not.toBeNull();
  root.unmount();
});
