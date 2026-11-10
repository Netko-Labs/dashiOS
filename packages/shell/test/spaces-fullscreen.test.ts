import { describe, expect, test } from "bun:test";
import type { CompositorWindow } from "../src/compositor/wire.ts";
import { buildMenu } from "../src/menus/model.ts";
import type { MenuContext } from "../src/menus/types.ts";
import { parseSettings } from "../src/settings.ts";
import { edgeHoldTarget } from "../src/spaces/lib/edge.ts";
import { desktopCount, desktopOrdinal, fitSlots, insertionPoint, nearestDesktop, originOf, recoverSlots, type Slots } from "../src/spaces/lib/slots.ts";
import { spaceLabels } from "../src/spaces/names.ts";
import { SCREEN, USABLE, win } from "./support/spaces-fullscreen.ts";

describe("which Spaces are full-screen Desktops", () => {
  const slots: Slots = [null, 7, null, 8, 9, null];

  test("Desktops are counted and named without the full-screen ones", () => {
    expect(desktopCount(slots)).toBe(3);
    expect(desktopOrdinal(slots, 0)).toBe(0);
    expect(desktopOrdinal(slots, 2)).toBe(1);
    expect(desktopOrdinal(slots, 5)).toBe(2);
  });

  test("the Desktop a full-screen one goes back to is the nearest on its left, else on its right", () => {
    expect(nearestDesktop(slots, 1)).toBe(0);
    expect(nearestDesktop(slots, 4)).toBe(2);
    expect(nearestDesktop([5, null], 0)).toBe(1);
    expect(nearestDesktop([5], 0)).toBeNull();
    // A dialog on a full-screen Desktop comes from that Desktop's own.
    expect(originOf(slots, 3)).toBe(2);
    expect(originOf(slots, 2)).toBe(2);
    expect(originOf(slots, 9)).toBeNull();
  });

  test("a new one goes right after its Desktop, after the ones from there already", () => {
    expect(insertionPoint(slots, 0)).toBe(2);
    expect(insertionPoint(slots, 2)).toBe(5);
    expect(insertionPoint(slots, 5)).toBe(6);
  });

  test("Spaces the compositor added or dropped by itself are Desktops at the end", () => {
    expect(fitSlots([null, 4], 4)).toEqual([null, 4, null, null]);
    expect(fitSlots([null, 4, null], 1)).toEqual([null]);
  });

  test("after a restart: a Space whose one window is full screen, its dialogs and sheets aside", () => {
    const windows = [
      win(1, 0),
      win(2, 1, { fullscreen: true }),
      win(3, 1, { parent: 2 }),
      win(4, 1, { sheetOf: 2 }),
      win(5, 2, { fullscreen: true }),
      win(6, 2),
      win(7, 3, { fullscreen: true, state: "minimized" }),
    ];
    expect(recoverSlots(4, windows)).toEqual([null, 2, null, null]);
    // settings.json counted 4 Desktops of 4 Spaces: none was a full-screen one.
    expect(recoverSlots(4, windows, 0)).toEqual([null, null, null, null]);
    // One Desktop is always left.
    expect(recoverSlots(1, [win(1, 0, { fullscreen: true })])).toEqual([null]);
  });

  test("a full-screen Desktop is named after its app, and the names skip it", () => {
    const windows = [win(1, 0), win(2, 1, { appId: "game" }), win(3, 2)];
    const appName = (window: CompositorWindow) => (window.appId === "game" ? "Game" : window.appId);
    expect(spaceLabels(4, ["Work", "Play"], windows, appName, [null, 2, null, null])).toEqual(["Work", "Game", "Play", "Desktop 4"]);
  });

  test("a held window passes over full-screen Desktops at the edge", () => {
    const one = [{ name: "eDP-1", frame: SCREEN, usable: USABLE, scale: 1 }];
    const hold = { edge: "right" as const, output: "eDP-1", preview: false };
    expect(edgeHoldTarget(hold, one, { count: 4, current: 0 }, [null, 5, null, 6])).toBe(2);
    expect(edgeHoldTarget(hold, one, { count: 4, current: 2 }, [null, 5, null, 6])).toBeNull();
    expect(edgeHoldTarget({ ...hold, edge: "left" }, one, { count: 4, current: 2 }, [null, 5, null, 6])).toBe(0);
  });

  test("the setting is on unless turned off", () => {
    expect(parseSettings({}).settings.spaces.fullscreenDesktop).toBe(true);
    expect(parseSettings({ spaces: { fullscreenDesktop: false } }).settings.spaces.fullscreenDesktop).toBe(false);
  });

  test("the Window menu offers no full-screen Desktop, and nothing for a window on its own", () => {
    const focused = win(1, 0);
    const ctx = (window: CompositorWindow): MenuContext => ({
      appName: "App",
      windows: [window],
      focused: window,
      canLaunch: false,
      canOpenHelp: false,
      desktops: { labels: ["Desktop 1", "Game", "Desktop 3"], current: 0, fullscreen: [null, 2, null] },
    });
    const labels = (window: CompositorWindow) =>
      buildMenu("window", ctx(window)).flatMap((entry) => (entry.kind === "item" && entry.label.startsWith("Move to") ? [entry.label] : []));
    expect(labels(focused)).toEqual(["Move to Desktop 3", "Move to New Desktop"]);
    expect(labels(win(2, 1))).toEqual([]);
  });
});
