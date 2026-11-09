/**
 * The menu bar from the keyboard (menus/bar-keys.ts, the controller's
 * `focusBar`, `barKey`, `side`, `back`): ⌃F2 puts the ring on the Dashi
 * menu, ← → walk the titles then the status items as drawn, Return, Space
 * or ↓ open, ← → in a menu go to the next title's, Esc closes the menu and
 * then leaves the bar. And the status side's row as drawn (menubar-fit.ts
 * `statusRow`), which the keys walk.
 */

import { describe, expect, test } from "bun:test";
import { statusRow } from "../src/menubar-fit.ts";
import { type BarStop, barCommand, barOrder, MORE_STOP, sideStep, stepStop, stopOfPopover } from "../src/menus/bar-keys.ts";
import { MenuController } from "../src/menus/controller.ts";
import type { MenuContext } from "../src/menus/model.ts";
import { dropdownKey } from "../src/menus/view.tsx";

describe("the bar's order", () => {
  test("the titles left to right, then the status side's row", () => {
    expect(barOrder(["dashi", "app", "app:0"], ["extra:tray", MORE_STOP, "agent-mark", "sound", "network", "control-center", "clock"])).toEqual([
      "menu:dashi",
      "menu:app",
      "menu:app:0",
      "extra:tray",
      MORE_STOP,
      "agent-mark",
      "sound",
      "network",
      "control-center",
      "clock",
    ]);
  });

  test("the status row: '…' right of the extras still shown, only while something went", () => {
    const slots = [
      { key: "extra:a", extra: true },
      { key: "extra:b", extra: true },
      { key: "agent-mark" },
      { key: "sound" },
      { key: "control-center" },
      { key: "clock" },
    ];
    expect(statusRow(slots, [], MORE_STOP)).toEqual({ visible: slots.map((slot) => slot.key), moreAt: -1, order: slots.map((slot) => slot.key) });
    expect(statusRow(slots, ["extra:a"], MORE_STOP).order).toEqual(["extra:b", MORE_STOP, "agent-mark", "sound", "control-center", "clock"]);
    // Every extra and Sound went: "…" leads the row.
    expect(statusRow(slots, ["extra:a", "extra:b", "sound"], MORE_STOP)).toEqual({
      visible: ["agent-mark", "control-center", "clock"],
      moreAt: 0,
      order: [MORE_STOP, "agent-mark", "control-center", "clock"],
    });
  });
});

describe("stepping", () => {
  const order = ["menu:dashi", "menu:app", "sound", "clock"];
  test("← → one at a time, wrapping at the ends", () => {
    expect(stepStop(order, "menu:dashi", "right")).toBe("menu:app");
    expect(stepStop(order, "clock", "right")).toBe("menu:dashi");
    expect(stepStop(order, "menu:dashi", "left")).toBe("clock");
  });
  test("from none, or a stop that went: → the first, ← the last", () => {
    expect(stepStop(order, null, "right")).toBe("menu:dashi");
    expect(stepStop(order, "agent-mark", "left")).toBe("clock");
    expect(stepStop([], null, "right")).toBeNull();
  });
  test("in a menu, a title's menu opens as the ring reaches it; a status item's does not", () => {
    const stops = [
      { key: "menu:dashi", kind: "menu" as const },
      { key: "menu:app", kind: "menu" as const },
      { key: "sound", kind: "panel" as const },
    ];
    expect(sideStep(stops, "menu:dashi", "right")).toEqual({ key: "menu:app", opens: true });
    expect(sideStep(stops, "menu:app", "right")).toEqual({ key: "sound", opens: false });
    expect(sideStep(stops, "menu:dashi", "left")).toEqual({ key: "sound", opens: false });
  });
});

describe("keys", () => {
  test("in the bar: ← → move, Return, Space and ↓ open, Esc leaves, the rest nothing", () => {
    expect(barCommand("left")).toEqual({ kind: "move", toward: "left" });
    expect(barCommand("right")).toEqual({ kind: "move", toward: "right" });
    for (const key of ["enter", "space", "down"]) expect(barCommand(key)).toEqual({ kind: "open" });
    expect(barCommand("escape")).toEqual({ kind: "leave" });
    expect(barCommand("up")).toBeNull();
    expect(barCommand("a")).toBeNull();
  });
  test("in a menu: ↑ ↓ step, Return and Space choose, ← → go along the bar, Esc closes", () => {
    expect(dropdownKey("down")).toEqual({ kind: "step", direction: "down" });
    expect(dropdownKey("up")).toEqual({ kind: "step", direction: "up" });
    expect(dropdownKey("enter")).toEqual({ kind: "choose" });
    expect(dropdownKey("space")).toEqual({ kind: "choose" });
    expect(dropdownKey("left")).toEqual({ kind: "side", toward: "left" });
    expect(dropdownKey("escape")).toEqual({ kind: "close" });
    expect(dropdownKey("tab")).toBeNull();
  });
  test("what is open names its stop", () => {
    expect(stopOfPopover({ kind: "menu", id: "app", x: 0 })).toBe("menu:app");
    expect(stopOfPopover({ kind: "status-menu", key: "nm-applet", right: 0, entries: [] })).toBe("extra:nm-applet");
    expect(stopOfPopover({ kind: "agents", right: 0, focus: null })).toBe("agent-mark");
    expect(stopOfPopover({ kind: "control-center", page: "wifi" })).toBe("network");
    expect(stopOfPopover({ kind: "control-center", page: "main" })).toBe("control-center");
    expect(stopOfPopover({ kind: "notification-center" })).toBe("clock");
    expect(stopOfPopover(null)).toBeNull();
  });
});

/** A controller on a fake surface, with one bar on "Virtual-1": two titles, Sound, the clock and the recording's stop. */
function harness() {
  const surfaces = { opened: 0, closed: 0 };
  const acted: string[] = [];
  const controller: MenuController = new MenuController({
    context: async (appName) => ({ appName }) as MenuContext,
    openSurface: () => {
      surfaces.opened++;
      return { close: () => void surfaces.closed++ };
    },
  });
  const output = "Virtual-1";
  const stops: BarStop[] = [
    { key: "menu:dashi", label: "Dashi", kind: "menu", open: () => void controller.toggleMenu("dashi", 6, "Files", output) },
    { key: "menu:app", label: "Files", kind: "menu", open: () => void controller.toggleMenu("app", 40, "Files", output) },
    { key: "sound", label: "Sound", kind: "panel", open: () => void controller.toggleControlCenter("Files", "main", output) },
    { key: "clock", label: "Notification Center", kind: "panel", open: () => void controller.toggleNotificationCenter("Files", output) },
    {
      key: "recording",
      label: "Stop recording",
      kind: "action",
      open: () => {
        acted.push("stop");
      },
    },
  ];
  controller.setBar(output, { appName: "Files", stops });
  const state = () => controller.getSnapshot();
  return { controller, surfaces, acted, state, output };
}

describe("the controller", () => {
  test("⌃F2: the ring on the Dashi menu, the popover surface holding the keys with nothing open", async () => {
    const { controller, surfaces, state } = harness();
    await controller.focusBar();
    expect(state()).toMatchObject({ popover: null, bar: "menu:dashi", appName: "Files", output: "Virtual-1" });
    expect(surfaces.opened).toBe(1);
    expect(controller.labelOf("menu:dashi")).toBe("Dashi");
  });

  test("→ walks along, ← wraps to the end", async () => {
    const { controller, state } = harness();
    await controller.focusBar("Virtual-1");
    controller.barKey("right");
    expect(state().bar).toBe("menu:app");
    controller.barKey("left");
    controller.barKey("left");
    expect(state().bar).toBe("recording");
  });

  test("↓ opens the title's menu, → the next title's, → past the titles closes it on Sound; Return opens Control Center there", async () => {
    const { controller, state } = harness();
    await controller.focusBar();
    controller.barKey("down");
    expect(state()).toMatchObject({ popover: { kind: "menu", id: "dashi" }, bar: "menu:dashi" });
    controller.side("right");
    expect(state()).toMatchObject({ popover: { kind: "menu", id: "app", x: 40 }, bar: "menu:app" });
    controller.side("right");
    expect(state()).toMatchObject({ popover: null, bar: "sound" });
    controller.barKey("enter");
    // The ring stays on Sound, which opened it, not Control Center's own item.
    expect(state()).toMatchObject({ popover: { kind: "control-center", page: "main" }, bar: "sound" });
  });

  test("Esc closes what is open and stays in the bar; a second Esc leaves, and the surface goes", async () => {
    const { controller, surfaces, state } = harness();
    await controller.focusBar();
    controller.barKey("right");
    controller.barKey("right");
    controller.barKey("space");
    expect(state().popover?.kind).toBe("control-center");
    controller.back();
    expect(state()).toMatchObject({ popover: null, bar: "sound" });
    expect(surfaces.closed).toBe(0);
    controller.barKey("escape");
    expect(state()).toMatchObject({ popover: null, appName: null });
    expect(state().bar).toBeUndefined();
    expect(surfaces.closed).toBe(1);
  });

  test("an item that only acts leaves the bar first, then acts", async () => {
    const { controller, surfaces, acted, state } = harness();
    await controller.focusBar();
    controller.barKey("left");
    controller.barKey("enter");
    expect(acted).toEqual(["stop"]);
    expect(state().bar).toBeUndefined();
    expect(surfaces.closed).toBe(1);
  });

  test("⌃F2 again leaves the bar", async () => {
    const { controller, surfaces, state } = harness();
    await controller.focusBar();
    await controller.focusBar();
    expect(state().bar).toBeUndefined();
    expect(surfaces.closed).toBe(1);
  });

  test("a menu opened with a click: ⌃F2 puts the ring on it; ← → in it go along the bar too", async () => {
    const { controller, state } = harness();
    await controller.toggleMenu("app", 40, "Files", "Virtual-1");
    expect(state().bar).toBeUndefined();
    controller.side("left");
    expect(state()).toMatchObject({ popover: { kind: "menu", id: "dashi" }, bar: "menu:dashi" });
    controller.close();
    await controller.toggleMenu("app", 40, "Files", "Virtual-1");
    await controller.focusBar();
    expect(state()).toMatchObject({ popover: { kind: "menu", id: "app" }, bar: "menu:app" });
  });

  test("without the bar, Esc in a menu closes it", async () => {
    const { controller, surfaces, state } = harness();
    await controller.toggleMenu("app", 40, "Files", "Virtual-1");
    controller.back();
    expect(state().popover).toBeNull();
    expect(surfaces.closed).toBe(1);
  });

  test("keys mean nothing when the keyboard isn't in the bar", async () => {
    const { controller, state } = harness();
    controller.barKey("right");
    expect(state().popover).toBeNull();
    expect(state().bar).toBeUndefined();
  });

  test("a screen without a bar: the first bar's", async () => {
    const { controller, state } = harness();
    await controller.focusBar("HDMI-A-1");
    expect(state()).toMatchObject({ bar: "menu:dashi", output: "Virtual-1" });
  });
});
