/**
 * Moving a window to the other screen (decisions.md D535): the Window menu's "Move to" a screen, named as
 * Displays names it, and the arranger carrying the window there at the same place, or the same tile.
 */

import { describe, expect, test } from "bun:test";
import { outputsOf } from "../src/compositor/index.ts";
import { menuScreens } from "../src/menus/lib/wiring.tsx";
import { buildMenu } from "../src/menus/model.ts";
import type { MenuContext } from "../src/menus/types.ts";
import { files, rect, SCREEN, started, USABLE } from "./support/window-arrange.ts";

const SECOND = { name: "HDMI-A-1", frame: rect(1646, 0, 1920, 1080), usable: rect(1646, 28, 1920, 981) };
const BOTH = [
  { name: "Virtual-1", frame: SCREEN, usable: USABLE },
  { name: "HDMI-A-1", frame: SECOND.frame, usable: SECOND.usable },
];

describe("the Window menu", () => {
  const focused = { ...files(), focused: true };
  const ctx = (fields: Partial<MenuContext>): MenuContext => ({ appName: "Files", windows: [focused], focused, canLaunch: true, canOpenHelp: true, ...fields });
  const screenRows = (context: MenuContext) =>
    buildMenu("window", context).flatMap((entry) => (entry.kind === "item" && entry.action?.kind === "move-to-screen" ? [entry] : []));
  const screens = [
    { name: "eDP-1", label: "Built-in Display", frame: SCREEN },
    { name: "HDMI-A-1", label: "LS49AG95", frame: SECOND.frame },
  ];

  test("offers the other screen, by its name, with two screens", () => {
    const rows = screenRows(ctx({ screens }));
    expect(rows.map((row) => row.label)).toEqual(["Move to LS49AG95"]);
    expect(rows[0]?.action).toEqual({ kind: "move-to-screen", window: 7, screen: "HDMI-A-1" });
  });

  test("nothing with one screen, or for a full-screen window", () => {
    expect(screenRows(ctx({ screens: screens.slice(0, 1) }))).toEqual([]);
    const fullscreen = { ...focused, fullscreen: true };
    expect(screenRows(ctx({ screens, focused: fullscreen, windows: [fullscreen] }))).toEqual([]);
  });

  test("names screens as Displays does: the built-in one, a monitor by its model; off or mirroring ones are left out", () => {
    const outputs = outputsOf({
      outputs: [
        { name: "eDP-1", make: "BOE", model: "0x0BCA", frame: SCREEN, usable: USABLE },
        { name: "HDMI-A-1", make: "Samsung", model: "LS49AG95", serial: "H4ZR", frame: SECOND.frame, usable: SECOND.usable },
        { name: "DP-2", make: "Dell", model: "U2720Q", serial: "1", enabled: false },
        { name: "DP-3", make: "Dell", model: "U2720Q", serial: "2", mirrorOf: "eDP-1", frame: SCREEN, usable: USABLE },
      ],
    });
    const read = menuScreens(outputs);
    expect(read.map((screen) => screen.label)).toEqual(["Built-in Display", "LS49AG95"]);
  });
});

describe("carried to the other screen", () => {
  test("at the same place in its usable area", async () => {
    const { arranger, frames } = await started(files(), BOTH);
    await arranger.toScreen(7, "HDMI-A-1");
    expect(frames()).toEqual([["frame", { window: 7, x: 1946, y: 200, width: 800, height: 600 }]]);
  });

  test("a tiled window takes the same tile there, and Back gives its own frame there", async () => {
    const { arranger, frames } = await started(files(), BOTH);
    await arranger.arrow(7, "left");
    await arranger.toScreen(7, "HDMI-A-1");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, x: 1652, y: 34, width: 951, height: 969, tiled: true }]);
    await arranger.arrange(7, "restore");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, x: 1946, y: 200, width: 800, height: 600 }]);
  });

  test("nothing when it is on that screen already", async () => {
    const { arranger, frames } = await started(files(), BOTH);
    await arranger.toScreen(7, "Virtual-1");
    expect(frames()).toEqual([]);
  });
});
