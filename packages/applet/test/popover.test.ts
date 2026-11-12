import { expect, test } from "bun:test";
import type { NativeEvent, NativeHostTransport } from "@mirinjs/metal";
import { View } from "@mirinjs/metal";
import { createElement } from "react";
import { openPopoverWindow, popoverSurface } from "../src/popover.tsx";
import { settle } from "./support/time.ts";

const PLACEMENT = { x: 10, y: 20, width: 300, height: 160, namespace: "dashi.applet.dev.example.weather", output: null };

function fakeHost() {
  const sent: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  let closed = 0;
  const host = {
    send: (frame: string) => sent.push(frame),
    hide() {},
    onEvent: (listener: (event: NativeEvent) => void) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close: () => {
      closed++;
    },
    onToplevel() {},
    toplevel() {},
    unlock() {},
    setTitle() {},
    setSize() {},
    setMinSize() {},
    open() {},
  } as unknown as NativeHostTransport;
  const tree = (): { props: Record<string, unknown> } => JSON.parse(sent.at(-1) ?? "{}");
  const emit = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  return { host, tree, emit, closed: () => closed };
}

test("a popover takes the keyboard as the shell's menus do; a launcher view leaves it to the launcher", () => {
  expect(popoverSurface(PLACEMENT)).toMatchObject({ role: "layer", keyboard: "exclusive" });
  expect(popoverSurface(PLACEMENT, "on-demand")).toMatchObject({ role: "layer", keyboard: "on-demand" });
});

test("Esc closes an applet's popover, and the applet hears it closed", async () => {
  const fake = fakeHost();
  let closedTold = 0;
  const popover = openPopoverWindow({
    appId: "dev.example.weather",
    title: "Weather",
    placement: PLACEMENT,
    element: createElement(View),
    onClosed: () => closedTold++,
    spawn: () => fake.host,
  });
  await settle();
  const ground = fake.tree();
  expect(ground.props.onWindowKey).toBe(true);
  // Another key leaves it open.
  fake.emit({ type: "windowkey", nodeId: String(ground.props.id), key: "a", ctrl: false, alt: false, shift: false, meta: false, repeat: false } as NativeEvent);
  expect(closedTold).toBe(0);
  fake.emit({
    type: "windowkey",
    nodeId: String(ground.props.id),
    key: "escape",
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    repeat: false,
  } as NativeEvent);
  expect(closedTold).toBe(1);
  expect(fake.closed()).toBeGreaterThan(0);
  // Once, however it closes.
  popover.close();
  expect(closedTold).toBe(1);
});

test("a launcher view doesn't take Esc: the launcher closes it", async () => {
  const fake = fakeHost();
  const view = openPopoverWindow({
    appId: "dev.example.weather",
    title: "Weather",
    placement: PLACEMENT,
    element: createElement(View),
    onClosed() {},
    spawn: () => fake.host,
    keyboard: "on-demand",
  });
  await settle();
  expect(fake.tree().props.onWindowKey).toBeUndefined();
  view.close();
});
