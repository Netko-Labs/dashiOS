import { expect, test } from "bun:test";
import { type NativeEvent, render, View } from "@mirinjs/metal";
import { useState } from "react";
import { type AlertButton, AlertSheet, AlertWindow, alertKeyTarget } from "../src/alert.tsx";
import { ShowStates } from "../src/control-state.tsx";
import { Button } from "../src/controls.tsx";
import { WARNING } from "../src/glyphs.ts";
import { PopUpButton } from "../src/popup-button.tsx";
import { ProgressBar } from "../src/progress.tsx";
import { MENU_SEPARATOR, PopupMenu } from "../src/sheet.tsx";
import { Slider } from "../src/slider.tsx";
import { Appearance, useColors } from "../src/theme/appearance.ts";
import { darkColors, lightColors } from "../src/theme/palette.ts";
import { AppWindow } from "../src/window.tsx";
import { fakeHost, settle } from "./host.ts";

const noop = (): void => {};

/** A key the window got, as Metal hands it to a KeySink (`onWindowKeyDown`). */
const windowKey = (nodeId: string, key: string): NativeEvent => ({
  type: "windowkey",
  nodeId,
  key,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  repeat: false,
});

test("Esc presses the cancel button and Enter the default one; a grant is never Enter's", () => {
  const cancel: AlertButton = { label: "Cancel", testID: "c", onPress: noop, cancel: true };
  const go: AlertButton = { label: "Go", testID: "g", onPress: noop, kind: "primary" };
  expect(alertKeyTarget({ kind: "escape" }, [cancel, go])).toBe(cancel);
  expect(alertKeyTarget({ kind: "enter" }, [cancel, go])).toBe(go);
  // Destroying: Cancel is the default, so Enter cancels too.
  const safe = { ...cancel, isDefault: true };
  expect(alertKeyTarget({ kind: "enter" }, [safe, { ...go, kind: "danger" }])).toBe(safe);
  // A grant: only a click.
  expect(alertKeyTarget({ kind: "enter" }, [cancel, { ...go, isDefault: false }])).toBeNull();
  // A disabled default is no default.
  expect(alertKeyTarget({ kind: "enter" }, [cancel, { ...go, disabled: true }])).toBeNull();
  // A message that only informs: its one button is both.
  const ok: AlertButton = { label: "OK", testID: "ok", onPress: noop, kind: "primary" };
  expect(alertKeyTarget({ kind: "escape" }, [ok])).toBe(ok);
  expect(alertKeyTarget({ kind: "enter" }, [ok])).toBe(ok);
  expect(alertKeyTarget({ kind: "text", text: "y" }, [ok])).toBeNull();
});

test("an alert sheet answers Esc and Enter through its buttons", async () => {
  const host = fakeHost();
  const pressed: string[] = [];
  const root = render(
    <AlertSheet
      testID="ask"
      question="That didn’t work"
      message="The file is gone."
      glyph={WARNING}
      buttons={[{ label: "OK", testID: "ask:ok", onPress: () => pressed.push("ok"), kind: "primary" }]}
    />,
    host.transport,
  );
  await settle();
  const keys = root.nodeId("ask:keys") as string;
  host.emit(windowKey(keys, "escape"));
  host.emit(windowKey(keys, "enter"));
  expect(pressed).toEqual(["ok", "ok"]);
  expect(host.last()).toContain("That didn’t work");
  root.unmount();
});

test("an alert window draws the question as its first line, with no title row", async () => {
  const host = fakeHost();
  const pressed: string[] = [];
  const root = render(
    <AlertWindow
      testID="w"
      question="Use the camera?"
      glyph={WARNING}
      buttons={[
        { label: "Don’t Allow", testID: "w:deny", onPress: () => pressed.push("deny"), cancel: true },
        { label: "Allow", testID: "w:allow", onPress: () => pressed.push("allow"), kind: "primary", isDefault: false },
      ]}
    />,
    host.transport,
  );
  host.emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 22 } });
  await settle();
  expect(root.nodeId("window-toolbar")).toBeUndefined();
  const keys = root.nodeId("w:keys") as string;
  host.emit(windowKey(keys, "enter"));
  host.emit(windowKey(keys, "escape"));
  expect(pressed).toEqual(["deny"]);
  root.unmount();
});

test("a pop-up button opens its options over itself, the chosen one ticked, and picks one", async () => {
  const host = fakeHost();
  function Picker() {
    const [paper, setPaper] = useState("a4");
    return (
      <AppWindow title="Print">
        <PopUpButton
          testID="paper"
          value={paper}
          onChange={setPaper}
          options={[{ value: "a4", label: "A4" }, { value: "letter", label: "US Letter" }, MENU_SEPARATOR, { value: "a5", label: "A5" }]}
        />
      </AppWindow>
    );
  }
  const root = render(<Picker />, host.transport);
  await settle();
  expect(root.nodeId("paper:menu")).toBeUndefined();
  host.emit({ type: "press", nodeId: root.nodeId("paper") as string, bounds: { x: 200, y: 100, width: 120, height: 28 } });
  await settle();
  expect(root.nodeId("paper:menu")).toBeDefined();
  host.emit({ type: "press", nodeId: root.nodeId("paper:menu:A5") as string });
  await settle();
  expect(root.nodeId("paper:menu")).toBeUndefined();
  expect(host.last()).toContain("A5");
  root.unmount();
});

test("a popup menu draws its separators and keys its rows by place, not label", async () => {
  const host = fakeHost();
  const root = render(
    <PopupMenu x={10} y={10} onClose={noop} items={[{ label: "Same", onPress: noop }, MENU_SEPARATOR, { label: "Same", onPress: noop }, MENU_SEPARATOR]} />,
    host.transport,
  );
  await settle();
  // Two rows of the same label both draw; the trailing separator doesn't.
  expect(host.last().match(/"Same"/g)).toHaveLength(2);
  root.unmount();
});

test("a disabled button is the whole button dimmed, and a shown press deepens it", async () => {
  const host = fakeHost();
  const root = render(
    <View>
      <Button label="Save" testID="off" primary disabled onPress={noop} />
      <ShowStates pressed>
        <Button label="Save" testID="held" primary onPress={noop} />
      </ShowStates>
    </View>,
    host.transport,
  );
  await settle();
  expect(host.last()).toContain('"opacity":0.4');
  // Still kombu, not gray: a disabled primary reads as primary.
  expect(host.last()).toContain(lightColors.selection);
  expect(host.last()).toContain(lightColors.selectionPressed);
  root.unmount();
});

test("Appearance paints its part in the mode it names, whatever Dark Mode is", async () => {
  const host = fakeHost();
  const seen: string[] = [];
  function Probe({ name }: { name: string }) {
    seen.push(`${name}:${useColors().text}`);
    return null;
  }
  const root = render(
    <View>
      <Probe name="window" />
      <Appearance dark>
        <Probe name="dark" />
      </Appearance>
    </View>,
    host.transport,
  );
  await settle();
  expect(seen).toContain(`window:${lightColors.text}`);
  expect(seen).toContain(`dark:${darkColors.text}`);
  root.unmount();
});

test("a progress bar fills to its value; without one it slides", async () => {
  const host = fakeHost();
  const root = render(
    <View>
      <ProgressBar testID="half" value={0.5} width={200} />
      <ProgressBar testID="busy" value={null} width={200} />
    </View>,
    host.transport,
  );
  await settle();
  expect(root.nodeId("half")).toBeDefined();
  expect(host.last()).toContain(lightColors.selection);
  root.unmount();
});

test("a slider follows the drag and commits once, when the button lifts", async () => {
  const host = fakeHost();
  const moves: number[] = [];
  const commits: number[] = [];
  const root = render(
    <Slider testID="s" value={0} range={{ min: 0, max: 100, step: 1 }} width={218} onChange={(v) => moves.push(v)} onCommit={(v) => commits.push(v)} />,
    host.transport,
  );
  await settle();
  const id = root.nodeId("s") as string;
  const bounds = { x: 0, y: 0, width: 218, height: 22 };
  host.emit({ type: "pointer", nodeId: id, phase: "down", x: 9, y: 10, bounds });
  host.emit({ type: "pointer", nodeId: id, phase: "move", x: 109, y: 10, bounds });
  host.emit({ type: "pointer", nodeId: id, phase: "up", x: 209, y: 10, bounds });
  await settle();
  expect(moves).toEqual([0, 50, 100]);
  expect(commits).toEqual([100]);
  root.unmount();
});
