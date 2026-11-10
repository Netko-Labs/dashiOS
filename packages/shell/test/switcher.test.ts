import { describe, expect, test } from "bun:test";
import type { CompositorWindow } from "../src/compositor.ts";
import { KEYMAP, SWITCHER_RULES, withSwitcher } from "../src/keymap/keymap.ts";
import { ruleFor } from "../src/keymap/keymap-match.ts";
import { SwitcherController } from "../src/switcher/controller.ts";
import { switcherLayout, switcherSize, THUMB } from "../src/switcher/layout.ts";
import { type AppGroup, chosenWindow, filterApps, groupByApp, isAway, stepSelection, switcherKey, visibleWindows } from "../src/switcher/model.ts";
import type { SwitcherState } from "../src/switcher/types.ts";
import { fakeCompositor as over } from "./support/compositor.ts";
import { settle } from "./support/time.ts";

let nextId = 1;
const win = (appId: string, title: string, state: CompositorWindow["state"] = "normal", pid: number | null = null): CompositorWindow => ({
  id: nextId++,
  appId,
  title,
  pid,
  focused: false,
  state,
  frame: null,
  titleBar: 0,
});

const NAMES: Record<string, string> = {
  "net.imput.helium": "Helium",
  "dev.dashi.notes": "Notes",
  "dev.dashi.terminal": "Terminal",
  "com.valvesoftware.Steam": "Steam",
};
const nameOf = (group: AppGroup) => NAMES[group.appId] ?? group.appId;

/** The compositor's order: front to back, then minimized, then hidden. */
function desktop(): CompositorWindow[] {
  return [
    win("net.imput.helium", "Docs"),
    win("dev.dashi.terminal", "~/dashi"),
    win("net.imput.helium", "Mail"),
    win("dev.dashi.notes", "Groceries"),
    win("net.imput.helium", "Calendar", "minimized"),
    win("com.valvesoftware.Steam", "Steam", "hidden"),
  ];
}

describe("grouping", () => {
  test("one entry per app, most recent first, each with every window in order", () => {
    const groups = groupByApp(desktop());
    expect(groups.map((group) => group.appId)).toEqual(["net.imput.helium", "dev.dashi.terminal", "dev.dashi.notes", "com.valvesoftware.Steam"]);
    expect(groups[0]?.windows.map((window) => window.title)).toEqual(["Docs", "Mail", "Calendar"]);
  });

  test("processes of one app are one app; without an app id, a process is", () => {
    const groups = groupByApp([
      win("foot", "a", "normal", 10),
      win("foot", "b", "normal", 11),
      win("", "x", "normal", 12),
      win("", "y", "normal", 12),
      win("", "z", "normal", null),
    ]);
    expect(groups.map((group) => group.windows.length)).toEqual([2, 2, 1]);
  });

  test("an app with everything out of sight is away (dimmed)", () => {
    const groups = groupByApp(desktop());
    expect(groups.map(isAway)).toEqual([false, false, false, true]);
  });
});

describe("typing to find", () => {
  const groups = groupByApp(desktop());

  test("an app's name finds it with all its windows; a title finds that window", () => {
    expect(filterApps(groups, "hel", nameOf).map((group) => [group.appId, group.windows.length])).toEqual([["net.imput.helium", 3]]);
    const groceries = filterApps(groups, "groc", nameOf);
    expect(groceries.map((group) => group.windows.map((window) => window.title))).toEqual([["Groceries"]]);
    expect(filterApps(groups, "MAIL", nameOf)[0]?.windows.map((window) => window.title)).toEqual(["Mail"]);
  });

  test("names that start with it come first; nothing typed is everything; nothing found is empty", () => {
    // "te" starts Terminal's name and is inside Notes' and Steam's.
    expect(filterApps(groups, "te", nameOf).map(nameOf)).toEqual(["Terminal", "Notes", "Steam"]);
    expect(filterApps(groups, "  ", nameOf)).toHaveLength(groups.length);
    expect(filterApps(groups, "zzz", nameOf)).toEqual([]);
  });

  test("Q, H, M, W act while nothing is typed; after that every letter types", () => {
    expect(switcherKey("q", "")).toEqual({ kind: "act", action: "quit" });
    expect(switcherKey("W", "")).toEqual({ kind: "act", action: "close" });
    expect(switcherKey("e", "")).toEqual({ kind: "type", text: "e" });
    expect(switcherKey("h", "e")).toEqual({ kind: "type", text: "h" });
    expect(switcherKey("space", "vs")).toEqual({ kind: "type", text: " " });
    expect(switcherKey("7", "")).toEqual({ kind: "type", text: "7" });
    expect(switcherKey("Return", "")).toBeNull();
    expect(switcherKey("é", "")).toBeNull();
  });
});

describe("step order", () => {
  const groups = groupByApp(desktop());

  test("Tab and ⇧Tab go through the apps and wrap", () => {
    expect(stepSelection({ app: 0, window: null }, groups, "next")).toEqual({ app: 1, window: null });
    expect(stepSelection({ app: 3, window: null }, groups, "next")).toEqual({ app: 0, window: null });
    expect(stepSelection({ app: 0, window: null }, groups, "previous")).toEqual({ app: 3, window: null });
    // From a window, Tab goes on to the next app.
    expect(stepSelection({ app: 0, window: 2 }, groups, "next")).toEqual({ app: 1, window: null });
  });

  test("↓ and ` go into the app's windows and through them; ↑ goes back; ← → move along the row they are on", () => {
    let selection = stepSelection({ app: 0, window: null }, groups, "down");
    expect(selection).toEqual({ app: 0, window: 0 });
    selection = stepSelection(selection, groups, "down");
    selection = stepSelection(selection, groups, "down");
    expect(selection).toEqual({ app: 0, window: 2 });
    expect(stepSelection(selection, groups, "down")).toEqual({ app: 0, window: 0 });
    expect(stepSelection(selection, groups, "right")).toEqual({ app: 0, window: 0 });
    expect(stepSelection(selection, groups, "left")).toEqual({ app: 0, window: 1 });
    expect(stepSelection(selection, groups, "up")).toEqual({ app: 0, window: null });
    expect(stepSelection({ app: 1, window: null }, groups, "left")).toEqual({ app: 0, window: null });
  });

  test("the choice is the selected window, else the app's front one", () => {
    expect(chosenWindow(groups, { app: 0, window: 1 })?.title).toBe("Mail");
    expect(chosenWindow(groups, { app: 0, window: null })?.title).toBe("Docs");
    expect(chosenWindow([], { app: 0, window: null })).toBeNull();
  });

  test("a long row slides to keep the selected window in view", () => {
    expect(visibleWindows(3, null)).toEqual([0, 3]);
    expect(visibleWindows(10, 0, 6)).toEqual([0, 6]);
    expect(visibleWindows(10, 7, 6)).toEqual([2, 8]);
    expect(visibleWindows(10, 9, 6)).toEqual([4, 10]);
  });
});

describe("the session's keys", () => {
  const chord = (key: string, ...mods: Array<"super" | "shift">) => ({ key, mods: mods.length ? mods : (["super"] as const) });

  test("bound only in the switcher's keymap, ahead of the rest", () => {
    const keymap = withSwitcher(KEYMAP);
    expect(keymap.rules.slice(0, SWITCHER_RULES.length)).toEqual(SWITCHER_RULES);
    expect(ruleFor(chord("q"), "foot", keymap)?.bind).toBe("switcher-key");
    expect(ruleFor(chord("q"), "foot")?.bind).toBe("quit-app");
    expect(ruleFor(chord("grave"), "foot", keymap)?.bind).toBe("switcher-down");
    expect(ruleFor(chord("Down"), "foot", keymap)?.bind).toBe("switcher-down");
    expect(ruleFor(chord("BackSpace"), "foot", keymap)?.bind).toBe("switcher-erase");
    expect(ruleFor(chord("4"), "foot", keymap)?.bind).toBe("switcher-key");
    // Tab, ⇧Tab, and Esc stay the switcher's own rules.
    expect(ruleFor(chord("Tab"), "foot", keymap)?.bind).toBe("switch-next");
    expect(ruleFor({ key: "Tab", mods: ["super", "shift"] }, "foot", keymap)?.bind).toBe("switch-previous");
    expect(ruleFor(chord("Escape"), "foot", keymap)?.bind).toBe("switch-cancel");
  });
});

describe("the panel's size", () => {
  test("grows by the window row, and is as wide as the wider row", () => {
    const apps = switcherSize(3);
    const withRow = switcherSize(3, 2);
    expect(withRow.height - apps.height).toBe(THUMB.gap + THUMB.height + THUMB.title);
    expect(switcherSize(1, 4).width).toBeGreaterThan(switcherSize(1).width);
    expect(switcherSize(8, 1).width).toBe(switcherSize(8).width);
  });

  test("the app row stays put when the window row comes, and the pictures sit under it", () => {
    const size = switcherSize(4, 3);
    const without = switcherLayout(size.width, 4, 0);
    const withRow = switcherLayout(size.width, 4, 3);
    expect(withRow.apps).toEqual(without.apps);
    const [first] = withRow.windows;
    expect(first?.y).toBeGreaterThan((withRow.apps[0]?.y ?? 0) + (withRow.apps[0]?.height ?? 0));
    expect((withRow.panel.y ?? 0) + withRow.panel.height).toBeLessThanOrEqual(size.height);
    expect(withRow.titles[0]?.y).toBe((first?.y ?? 0) + THUMB.height);
  });
});

/** A compositor that lists windows and remembers what was asked of it. */
function fakeCompositor(windows: CompositorWindow[]) {
  const asked: Array<[string, unknown]> = [];
  const request = async (method: string, params: Record<string, unknown> = {}) => {
    asked.push([method, params.window]);
    return {};
  };
  return Object.assign(over(request, { windows: async () => windows }), { asked });
}

describe("a session", () => {
  test("Tab, typing, an action, and letting go, in order", async () => {
    const windows = desktop();
    const compositor = fakeCompositor(windows);
    const shown: SwitcherState[] = [];
    const keys: string[] = [];
    const controller = new SwitcherController(compositor, { show: (state) => shown.push(state), hide: () => {} }, nameOf, {
      begin: () => keys.push("begin"),
      end: () => keys.push("end"),
    });
    controller.step("next");
    controller.type("g");
    controller.type("r");
    await settle();
    expect(keys).toEqual(["begin"]);
    const found = shown.at(-1);
    expect(found?.query).toBe("gr");
    expect(found?.apps.map((app) => app.appId)).toEqual(["dev.dashi.notes"]);
    expect(found?.windows?.map((window) => window.title)).toEqual(["Groceries"]);
    controller.erase();
    controller.erase();
    controller.step("next");
    // Nothing typed: W closes the chosen app's front window.
    controller.type("w");
    controller.commit();
    await settle();
    await settle();
    expect(compositor.asked).toContainEqual(["close", windows[1]?.id]);
    expect(keys).toEqual(["begin", "end"]);
    // The terminal's only window closed: what comes forward is the app now at its place.
    expect(compositor.asked.at(-1)?.[0]).toBe("focus");
  });

  test("Q asks every window of the chosen app to close", async () => {
    const windows = desktop();
    const compositor = fakeCompositor(windows);
    const controller = new SwitcherController(compositor, { show: () => {}, hide: () => {} }, nameOf);
    controller.step("previous");
    controller.step("next");
    controller.type("q");
    controller.cancel();
    await settle();
    await settle();
    const closed = compositor.asked.filter(([method]) => method === "close").map(([, window]) => window);
    expect(closed).toEqual(windows.filter((window) => window.appId === "net.imput.helium").map((window) => window.id));
    expect(compositor.asked.some(([method]) => method === "focus")).toBe(false);
  });

  test("H then letting go of ❖: the app stays hidden", async () => {
    const windows = desktop();
    const compositor = fakeCompositor(windows);
    const controller = new SwitcherController(compositor, { show: () => {}, hide: () => {} }, nameOf);
    controller.step("next");
    controller.type("h");
    await settle();
    await settle();
    const hidden = compositor.asked.filter(([method]) => method === "hide").map(([, window]) => window);
    expect(hidden.length).toBeGreaterThan(0);
    controller.commit();
    await settle();
    await settle();
    const focused = compositor.asked.filter(([method]) => method === "focus").map(([, window]) => window);
    expect(focused.filter((window) => hidden.includes(window))).toEqual([]);
  });
});
