import { expect, test } from "bun:test";
import { render, View, type WindowKeyInfo } from "@mirinjs/metal";
import { Button } from "../src/controls.tsx";
import { Segmented } from "../src/fields.tsx";
import { KeySink } from "../src/key-sink.tsx";
import { type KeyInput, keyInputFor } from "../src/keys.ts";
import { Sheet } from "../src/sheet.tsx";
import { Switch } from "../src/switch.tsx";
import { contrastRatio } from "../src/theme/contrast.ts";
import { darkColors, lightColors } from "../src/theme/palette.ts";
import { DARK_SURFACE, LIGHT_SURFACE } from "../src/theme/surface.ts";
import { fakeHost, settle } from "./host.ts";

const key = (name: string, more: Partial<WindowKeyInfo> = {}): WindowKeyInfo => ({
  key: name,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  repeat: false,
  ...more,
});

test("a window key is the text it types, or one of the keys apps match", () => {
  expect(keyInputFor(key("a", { text: "a" }))).toEqual({ kind: "text", text: "a" });
  expect(keyInputFor(key("a", { text: "A", shift: true }))).toEqual({ kind: "text", text: "A" });
  expect(keyInputFor(key("space", { text: " " }))).toEqual({ kind: "text", text: " " });
  expect(keyInputFor(key("enter"))).toEqual({ kind: "enter" });
  expect(keyInputFor(key("escape"))).toEqual({ kind: "escape" });
  expect(keyInputFor(key("backspace"))).toEqual({ kind: "backspace" });
  expect(keyInputFor(key("up"))).toEqual({ kind: "up" });
  expect(keyInputFor(key("down"))).toEqual({ kind: "down" });
  // Keys that type nothing apps match, and control characters, are nothing.
  expect(keyInputFor(key("left"))).toBeNull();
  expect(keyInputFor(key("f5"))).toBeNull();
  expect(keyInputFor(key("delete", { text: "\u007f" }))).toBeNull();
});

test("a chord is a shortcut, not typing, except Ctrl+V, which pastes", () => {
  expect(keyInputFor(key("n", { text: "n", ctrl: true }))).toBeNull();
  expect(keyInputFor(key("n", { text: "n", meta: true }))).toBeNull();
  expect(keyInputFor(key("x", { text: "x", alt: true }))).toBeNull();
  expect(keyInputFor(key("v", { ctrl: true, pasted: "1,234" }))).toEqual({ kind: "text", text: "1,234" });
  // An empty clipboard pastes nothing.
  expect(keyInputFor(key("v", { ctrl: true, pasted: "" }))).toBeNull();
  expect(keyInputFor(key("v", { ctrl: true }))).toBeNull();
});

test("the KeySink hears the window's keys, and a new focusKey is a new sink", async () => {
  const host = fakeHost();
  const keys: KeyInput[] = [];
  const root = render(
    <View>
      <KeySink testID="sink" onKey={(input) => keys.push(input)} />
    </View>,
    host.transport,
  );
  await settle();
  const sink = root.nodeId("sink") as string;
  expect(host.last()).toContain(`"id":"${sink}"`);
  expect(host.last()).toContain('"onWindowKey":true');
  host.emit({ type: "windowkey", nodeId: sink, ...key("5", { text: "5" }) });
  host.emit({ type: "windowkey", nodeId: sink, ...key("tab") });
  host.emit({ type: "windowkey", nodeId: sink, ...key("escape") });
  expect(keys).toEqual([{ kind: "text", text: "5" }, { kind: "escape" }]);
  root.unmount();

  const again = fakeHost();
  const ids: string[] = [];
  function Sink({ focusKey }: { focusKey: number }) {
    return <KeySink testID="sink" focusKey={focusKey} onKey={() => {}} />;
  }
  const first = render(<Sink focusKey={1} />, again.transport);
  await settle();
  ids.push(first.nodeId("sink") as string);
  first.unmount();
  const second = render(<Sink focusKey={2} />, again.transport);
  await settle();
  ids.push(second.nodeId("sink") as string);
  expect(ids[0]).not.toBe(ids[1]);
  second.unmount();
});

test("buttons, switches, and segments take the keyboard; a sheet keeps Tab inside", async () => {
  const host = fakeHost();
  const root = render(
    <View>
      <Button testID="go" label="Go" onPress={() => {}} />
      <Button testID="off" label="Off" disabled onPress={() => {}} />
      <Switch testID="wifi" on onChange={() => {}} />
      <Switch testID="shown" on={false} />
      <Segmented
        testID="view"
        value="week"
        onChange={() => {}}
        options={[
          { value: "day", label: "Day" },
          { value: "week", label: "Week" },
        ]}
      />
      <Sheet testID="ask" onCancel={() => {}}>
        <View />
      </Sheet>
    </View>,
    host.transport,
  );
  await settle();
  const tree = JSON.parse(host.last()) as { props: Record<string, unknown>; children?: unknown[] };
  const props = (testID: string): Record<string, unknown> => {
    const id = root.nodeId(testID);
    const find = (node: { props: Record<string, unknown>; children?: unknown[] }): Record<string, unknown> | undefined =>
      node.props.id === id
        ? node.props
        : (node.children ?? []).flatMap((child) => (typeof child === "object" && child !== null ? [find(child as typeof node)] : [])).find(Boolean);
    return find(tree) ?? {};
  };
  expect(props("go").focusable).toBe(true);
  expect(props("off").focusable).toBeUndefined();
  expect(props("wifi")).toMatchObject({ focusable: true, access: { role: "switch", checked: true } });
  // A switch that only shows its state is not a Tab stop.
  expect(props("shown").focusable).toBeUndefined();
  expect(props("view").focusGroup).toBe(true);
  expect(props("view:week")).toMatchObject({ focusable: true, access: { selected: true } });
  expect(props("view:day")).toMatchObject({ access: { selected: false } });
  expect(props("ask").focusTrap).toBe(true);
  root.unmount();
});

test("the focus ring stands 3:1 on every window ground, light and dark (KB-2, CO-6)", () => {
  for (const [colors, surface] of [
    [lightColors, LIGHT_SURFACE],
    [darkColors, DARK_SURFACE],
  ] as const) {
    for (const ground of [surface.window, surface.sidebar, surface.card]) {
      expect(contrastRatio(colors.focusRing, ground)).toBeGreaterThanOrEqual(3);
    }
  }
});
