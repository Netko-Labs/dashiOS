/**
 * Where a new window opens on two screens (arrange/lib/placing.ts, decisions.md D530–D532): the screen
 * the person works on, a dialog over its parent, an app's further window beside its front one, and an
 * app's first window where its last one was.
 */

import { describe, expect, test } from "bun:test";
import { type PlacingWorld, placement, remembers } from "../src/arrange/lib/placing.ts";
import type { CompositorWindow, Placing } from "../src/compositor/index.ts";
import type { Output } from "../src/layout.ts";
import { PORTAL_APP_ID } from "../src/shared/portal-host/index.ts";
import { CLIPBOARD_HELPER_APP_ID } from "../src/toplevels.ts";
import { rect } from "./support/window-arrange.ts";

/** The owner's laptop panel and, to its right, the Samsung on HDMI. */
const LAPTOP: Output = { name: "eDP-1", identity: "edid:BOE|0x0BCA|", frame: rect(0, 0, 1646, 1029), usable: rect(0, 28, 1646, 930), scale: 1.75 };
const SAMSUNG: Output = { name: "HDMI-A-1", identity: "edid:SAM|LS49|H4ZR", frame: rect(1646, 0, 1920, 1080), usable: rect(1646, 28, 1920, 981), scale: 2 };
const SCREENS = [LAPTOP, SAMSUNG];

const opening = (fields: Partial<Placing> = {}): Placing => ({ id: 50, appId: "dev.dashi.notes", title: "Notes", width: 800, height: 600, ...fields });
const shown = (id: number, appId: string, frame = rect(100, 100, 700, 500), fields: Partial<CompositorWindow> = {}): CompositorWindow => ({
  id,
  appId,
  title: appId,
  pid: 9,
  focused: false,
  state: "normal",
  frame,
  titleBar: 0,
  ...fields,
});
const world = (fields: Partial<PlacingWorld> = {}): PlacingWorld => ({ outputs: SCREENS, windows: [], pointer: null, ...fields });
const first = () => 0;

describe("where the person works", () => {
  test("a new app's window opens on the screen with the pointer, centered and a third of the way down", () => {
    const placed = placement(world({ pointer: { x: 2000, y: 500 } }), opening(), null, first);
    expect(placed?.frame).toEqual(rect(1646 + 560, 28 + 127, 800, 600));
  });

  test("with no pointer (the session was locked), the screen of the window with the keyboard", () => {
    const focused = shown(3, "org.gnome.Nautilus", rect(2000, 100, 700, 500), { focused: true });
    expect(placement(world({ windows: [focused] }), opening(), null, first)?.frame.x).toBeGreaterThanOrEqual(1646);
  });

  test("a window too big for the screen is shrunk inside what the bar and the Dock leave free", () => {
    const placed = placement(world({ pointer: { x: 10, y: 10 } }), opening({ width: 1800, height: 1200 }), null, first);
    expect(placed?.frame).toEqual(LAPTOP.usable);
  });
});

describe("beside its parent", () => {
  test("a dialog opens over its parent's window, on the parent's screen, wherever the pointer is", () => {
    const parent = shown(3, "org.gnome.TextEditor", rect(1800, 200, 1000, 700));
    const placed = placement(
      world({ windows: [parent], pointer: { x: 100, y: 100 } }),
      opening({ appId: "org.gnome.TextEditor", width: 400, height: 300, parent: 3 }),
      null,
      first,
    );
    expect(placed?.frame).toEqual(rect(1800 + 300, 200 + 133, 400, 300));
  });

  test("an app's further window steps down and right from its front window, on that window's screen", () => {
    const front = shown(3, "dev.dashi.notes", rect(1900, 100, 800, 600));
    const behind = shown(4, "dev.dashi.notes", rect(100, 100, 800, 600));
    const placed = placement(world({ windows: [front, behind], pointer: { x: 100, y: 100 } }), opening(), null, first);
    expect(placed?.frame).toEqual(rect(1928, 128, 800, 600));
  });

  test("an app that asked for a spot (X11) gets it, kept inside its screen", () => {
    const placed = placement(world({ pointer: { x: 100, y: 100 } }), opening({ position: { x: 3000, y: 40 } }), null, first);
    expect(placed?.frame).toEqual(rect(3566 - 800, 40, 800, 600));
  });
});

describe("an app's first window where its last one was", () => {
  const memory = { screen: SAMSUNG.identity ?? "", frame: rect(200, 100, 900, 700), tile: null, fullscreen: false, at: 1 };

  test("on its screen, at its frame, wherever the pointer is", () => {
    const placed = placement(world({ pointer: { x: 100, y: 100 } }), opening(), memory, first);
    expect(placed).toEqual({ frame: rect(1846, 100, 900, 700), tile: null, fullscreen: false, recalled: true });
  });

  test("pulled inside what the bar and the Dock leave free, when they changed", () => {
    const low = { ...memory, frame: rect(200, 600, 900, 700) };
    expect(placement(world(), opening(), low, first)?.frame).toEqual(rect(1846, 1009 - 700, 900, 700));
  });

  test("a tiled or filled window comes back tiled or filled", () => {
    const filled = { ...memory, tile: "fill" as const };
    expect(placement(world(), opening(), filled, first)).toMatchObject({ frame: SAMSUNG.usable, tile: "fill", recalled: true });
  });

  test("its screen gone: on the screen the person works on, at the same size", () => {
    const placed = placement(world({ outputs: [LAPTOP], pointer: { x: 100, y: 100 } }), opening(), memory, first);
    expect(placed?.frame).toEqual(rect(373, 28 + 76, 900, 700));
  });

  test("never while another of its windows is open (that one cascades), nor for a dialog", () => {
    const minimized = shown(3, "dev.dashi.notes", rect(0, 0, 1, 1), { state: "minimized", frame: null });
    expect(placement(world({ windows: [minimized], pointer: { x: 100, y: 100 } }), opening(), memory, first)?.recalled).toBe(false);
    expect(placement(world({ pointer: { x: 100, y: 100 } }), opening({ parent: 99 }), memory, first)?.recalled).toBe(false);
  });
});

test("the portal's dialogs and wl-copy's window neither take nor leave a memory, and they match the ids the shell knows", () => {
  expect(remembers(opening({ appId: PORTAL_APP_ID }))).toBe(false);
  expect(remembers(opening({ appId: CLIPBOARD_HELPER_APP_ID }))).toBe(false);
  expect(remembers(opening())).toBe(true);
});
