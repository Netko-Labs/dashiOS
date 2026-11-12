import { expect, test } from "bun:test";
import { render, View } from "@mirinjs/metal";
import { useState } from "react";
import { PopUpButton } from "../src/popup-button.tsx";
import { MENU_SEPARATOR, PopupMenu } from "../src/popup-menu.tsx";
import { Slider } from "../src/slider.tsx";
import { AppWindow } from "../src/window.tsx";
import { fakeHost } from "./host.ts";
import { noop, windowKey } from "./support/controls-view.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

fakeClockEachTest();

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

test("a pop-up button takes the keyboard: the arrows step its options, Space opens the menu, ↓ and Return pick", async () => {
  const host = fakeHost();
  const seen: string[] = [];
  function Picker() {
    const [paper, setPaper] = useState("a4");
    seen.push(paper);
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
  // One Tab stop, entered at the chosen option, its stop covering the button so the ring goes round it.
  const tree = host.last();
  expect(tree).toContain('"focusGroup":true');
  expect(tree).toContain('"selectsOnFocus":true');
  // →: Metal moves focus to the next stop and presses it.
  host.emit({ type: "press", nodeId: root.nodeId("paper:key:1") as string });
  await settle();
  expect(seen.at(-1)).toBe("letter");
  // Space on the chosen one opens the menu, its row lit; ↓ lights A5 and Return picks it.
  host.emit({ type: "press", nodeId: root.nodeId("paper:key:1") as string, bounds: { x: 200, y: 100, width: 120, height: 28 } });
  await settle();
  const keys = root.nodeId("paper:menu:keys") as string;
  expect(keys).toBeDefined();
  host.emit(windowKey(keys, "down"));
  await settle();
  host.emit(windowKey(keys, "enter"));
  await settle();
  expect(root.nodeId("paper:menu")).toBeUndefined();
  expect(seen.at(-1)).toBe("a5");
  root.unmount();
});

test("a disabled pop-up button or slider isn't a Tab stop", async () => {
  const host = fakeHost();
  const root = render(
    <View>
      <PopUpButton testID="p" value="a" onChange={noop} options={[{ value: "a", label: "A" }]} disabled />
      <Slider testID="s" value={0.5} disabled />
    </View>,
    host.transport,
  );
  await settle();
  expect(host.last()).not.toContain('"focusable":true');
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
