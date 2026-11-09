/**
 * The status side from the keyboard (menubar-status.tsx): it tells the bar
 * its stops in the order drawn, with "…" where it stands, opening each
 * where it is drawn; the ring is drawn on the item it is on, inside it (the
 * bar is one 28-tall row).
 */

import { expect, test } from "bun:test";
import { type Bounds, type NativeEvent, type NativeTransport, render, View } from "@mirinjs/metal";
import { useState } from "react";
import { StatusSide, type StatusSlot } from "../src/menubar-status.tsx";
import type { BarStop } from "../src/menus/bar-keys.ts";

interface Node {
  props?: Record<string, unknown>;
  children?: Node[];
}
const byId = (node: Node, id: string): Node | null =>
  node.props?.id === id ? node : ((node.children ?? []).map((child) => byId(child, id)).find(Boolean) ?? null);
const holds = (node: Node, id: string): boolean => node.props?.id === id || (node.children ?? []).some((child) => holds(child, id));

test("stops in the row's order, '…' among them; the ring inside the focused item", async () => {
  let last = "";
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (frame) => void (last = frame),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const opened: string[] = [];
  const slot = (key: string, extra: Partial<StatusSlot> = {}): StatusSlot => ({
    key,
    goes: null,
    label: key,
    open: { kind: "panel", run: (bounds: Bounds | null) => opened.push(`${key}@${bounds?.x ?? "?"}`) },
    node: <View testID={`item:${key}`} style={{ width: 20, height: 22 }} />,
    ...extra,
  });
  const slots = [
    slot("extra:a", { extra: true, goes: 0 }),
    slot("extra:b", { extra: true, goes: 1 }),
    // Someone sharing the screen: a pill nobody presses, passed over.
    { key: "capture", goes: null, node: <View /> },
    slot("agent-mark", { radius: 11 }),
    slot("clock"),
  ];
  let stops: BarStop[] = [];
  const more: number[] = [];
  let focus: (key: string | null) => void = () => {};
  function Side() {
    const [focused, setFocused] = useState<string | null>(null);
    focus = setFocused;
    return (
      <StatusSide
        slots={slots}
        room={210}
        areaOpen={false}
        moreOpen={false}
        onMore={(right) => more.push(right)}
        focused={focused}
        onStops={(each) => {
          stops = each;
        }}
      />
    );
  }
  const root = render(<Side />, transport);
  const settle = () => new Promise((done) => setTimeout(done, 20));
  await settle();
  const emit = (event: NativeEvent) => {
    for (const listener of listeners) listener(event);
  };
  // Each measured 40 wide: 5 × 44 doesn't fit 210, so the oldest extra goes into "…".
  slots.forEach((each, index) => {
    emit({ type: "resize", nodeId: root.nodeId(`status-slot:${each.key}`) ?? "", bounds: { x: 100 + 44 * index, y: 3, width: 40, height: 22 } });
  });
  await settle();
  expect(stops.map((stop) => stop.key)).toEqual(["extra:b", "more", "agent-mark", "clock"]);
  stops.find((stop) => stop.key === "agent-mark")?.open();
  expect(opened).toEqual(["agent-mark@232"]);
  stops.find((stop) => stop.key === "more")?.open();
  expect(more).toHaveLength(1);

  focus("agent-mark");
  await settle();
  const tree = JSON.parse(last) as Node;
  const ring = root.nodeId("bar-ring") ?? "";
  expect(holds(byId(tree, root.nodeId("status-slot:agent-mark") ?? "") ?? {}, ring)).toBe(true);
  expect(byId(tree, ring)?.props).toMatchObject({ left: 0, top: 0, right: 0, bottom: 0, borderWidth: 2, cornerRadius: 11 });

  focus("more");
  await settle();
  expect(holds(byId(JSON.parse(last) as Node, root.nodeId("status-more") ?? "") ?? {}, root.nodeId("bar-ring") ?? "")).toBe(true);
  root.unmount();
});
