/**
 * Editing widgets from the keyboard, as the Metal host sends keys: GPUI's
 * names ("tab", "up", "escape"), to the one view that takes the keyboard
 * while editing. Pass 49 found every advertised key did nothing: the keys
 * were matched by a browser's names, and the gallery's own key view took the
 * keyboard from the column's.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type NativeEvent, type NativeRoot, type NativeTransport, render, View } from "@mirinjs/metal";
import { INK_TEXT, lightColors } from "@dashi/ui";
import { NotificationArea } from "../src/notifications/area.tsx";
import { NotificationStore } from "../src/notifications/index.ts";
import { previewSizes } from "../src/widgets/gallery.tsx";
import { DASHI_WIDGETS, WidgetHub } from "../src/widgets/index.ts";
import { stepSize } from "../src/widgets/lib/edit-keys.ts";
import { settle } from "./support/time.ts";

let root: NativeRoot;
let hub: WidgetHub;
let listeners: ((event: NativeEvent) => void)[] = [];
let trees: string[] = [];
let closed = 0;

beforeEach(async () => {
  listeners = [];
  trees = [];
  closed = 0;
  hub = new WidgetHub({ notify() {}, live: false });
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  // The area is a fragment (its key catcher beside the column), as on its surface.
  root = render(
    <View style={{ width: 1200, height: 900 }}>
      <NotificationArea store={new NotificationStore({ schedule: () => () => {} })} onClose={() => closed++} dockInset={0} hub={hub} />
    </View>,
    transport,
  );
  await settle();
});
afterEach(() => root.unmount());

const id = (testID: string): string => {
  const found = root.nodeId(testID);
  if (!found) throw new Error(`no node ${testID}`);
  return found;
};
const emit = async (event: NativeEvent): Promise<void> => {
  for (const listener of listeners) listener(event);
  await settle();
};
const press = (testID: string) => emit({ type: "press", nodeId: id(testID) } as NativeEvent);
/** A key as the host sends it to the editing view. */
const key = (name: string, mods: { alt?: boolean; shift?: boolean } = {}) =>
  emit({
    type: "keydown",
    nodeId: id("widget-edit-keys"),
    key: name,
    ctrl: false,
    alt: mods.alt ?? false,
    shift: mods.shift ?? false,
    meta: false,
    repeat: false,
  });
const kinds = () => hub.store.getSnapshot().map((each) => `${each.kind}:${each.size}`);

describe("editing widgets by keyboard, with the host's key names", () => {
  test("Tab chooses, ⌥ arrows move, ⌥⇧ arrows resize, Delete removes, Return is Done", async () => {
    await press("edit-widgets");
    const [first, second] = kinds();
    await key("tab");
    expect(trees.at(-1)).toContain(" · ");
    await key("down", { alt: true });
    expect(kinds().slice(0, 2)).toEqual([second ?? "", first ?? ""]);
    const moved = hub.store.getSnapshot()[1];
    const info = DASHI_WIDGETS.find((each) => each.kind === moved?.kind);
    if (!moved || !info) throw new Error("no second widget");
    const smaller = stepSize(info.sizes, moved.size, -1);
    await key("left", { alt: true, shift: true });
    expect(kinds()[1]).toBe(`${moved.kind}:${smaller}`);
    // ⌥⇧→ as the host sends it: the keymap made it Ctrl⇧→ (a word move) on the way.
    await emit({ type: "keydown", nodeId: id("widget-edit-keys"), key: "right", ctrl: true, alt: false, shift: true, meta: false, repeat: false });
    expect(kinds()[1]).toBe(`${moved.kind}:${stepSize(info.sizes, smaller, 1)}`);
    const count = kinds().length;
    await key("delete");
    expect(kinds().length).toBe(count - 1);
    await key("enter");
    expect(root.nodeId("widget-edit-keys")).toBeUndefined();
    expect(root.nodeId("edit-widgets")).toBeDefined();
  });

  test("Esc ends editing, and only then closes the area", async () => {
    await press("edit-widgets");
    await key("escape");
    expect(root.nodeId("widget-edit-keys")).toBeUndefined();
    expect(closed).toBe(0);
  });

  test("in the gallery ↓ chooses the next widget, → a size, Return adds it, Esc closes the gallery and not editing", async () => {
    await press("edit-widgets");
    await press("edit-add");
    expect(root.nodeId("widget-gallery")).toBeDefined();
    // Weather is chosen first, at the size its line names first (Compact); the next in the list is chosen by ↓.
    const weather = DASHI_WIDGETS.find((each) => each.kind === "weather");
    if (!weather) throw new Error("no weather");
    const first = `picked:weather:${previewSizes(weather)[0]}`;
    expect(first).toBe("picked:weather:compact");
    expect(root.nodeId(first)).toBeDefined();
    await key("down");
    expect(root.nodeId(first)).toBeUndefined();
    const next = DASHI_WIDGETS[DASHI_WIDGETS.findIndex((each) => each.kind === "weather") + 1];
    if (!next) throw new Error("weather is last");
    const sizes = previewSizes(next);
    expect(root.nodeId(`picked:${next.kind}:${sizes[0]}`)).toBeDefined();
    await key("right");
    const size = sizes[Math.min(1, sizes.length - 1)];
    expect(root.nodeId(`picked:${next.kind}:${size}`)).toBeDefined();
    const count = kinds().length;
    await key("enter");
    expect(kinds().length).toBe(count + 1);
    expect(kinds().at(-1)).toBe(`${next.kind}:${size}`);
    await key("escape");
    expect(root.nodeId("widget-gallery")).toBeUndefined();
    expect(root.nodeId("widget-edit-keys")).toBeDefined();
  });

  test("the picked size and the chosen row are ringed in ink, never the focus ring's purple (CO-9, KB-2)", async () => {
    await press("edit-widgets");
    await press("edit-add");
    interface Node {
      props?: Record<string, unknown>;
      children?: Node[];
    }
    const byId = (node: Node, nodeId: string): Node | null =>
      node.props?.id === nodeId ? node : ((node.children ?? []).map((child) => byId(child, nodeId)).find(Boolean) ?? null);
    const tree = JSON.parse(trees.at(-1) ?? "{}") as Node;
    const edgeOf = (testID: string): string => String(byId(tree, id(testID))?.props?.borderColor ?? "").toLowerCase();
    for (const testID of ["picked:weather:compact", "gallery:weather"]) {
      expect(edgeOf(testID)).toBe(INK_TEXT.light.ink.toLowerCase());
      expect(edgeOf(testID)).not.toBe(lightColors.focusRing.toLowerCase());
    }
  });
});
