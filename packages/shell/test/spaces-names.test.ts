import { describe, expect, test } from "bun:test";
import type { CompositorWindow } from "../src/compositor.ts";
import { buildMenu } from "../src/menus/model.ts";
import type { MenuContext } from "../src/menus/types.ts";
import { parseSettings } from "../src/settings.ts";
import { autoName, cleanName, MAX_NAME, parseSpaceNames, renamed, spaceLabels, withoutSpace } from "../src/spaces/names.ts";

let nextId = 1;
const win = (appId: string, space: number, state: CompositorWindow["state"] = "normal"): CompositorWindow => ({
  id: nextId++,
  appId,
  title: appId,
  pid: null,
  focused: false,
  state,
  frame: null,
  titleBar: 0,
  space,
});

const NAMES: Record<string, string> = { "net.imput.helium": "Helium", "dev.dashi.terminal": "Terminal", "org.gnome.Calendar": "Calendar", foot: "Terminal" };
const appName = (window: CompositorWindow) => NAMES[window.appId] ?? window.appId;

describe("automatic names", () => {
  test("a Desktop is called after its apps, most recent first, one name per app", () => {
    const windows = [win("net.imput.helium", 1), win("dev.dashi.terminal", 1), win("net.imput.helium", 1), win("org.gnome.Calendar", 0)];
    expect(autoName(1, windows, appName)).toBe("Helium, Terminal");
    expect(autoName(0, windows, appName)).toBe("Calendar");
  });

  test("past two apps, the rest are counted", () => {
    const windows = [win("net.imput.helium", 0), win("dev.dashi.terminal", 0), win("org.gnome.Calendar", 0), win("org.gnome.Maps", 0)];
    expect(autoName(0, windows, appName)).toBe("Helium, Terminal +2");
  });

  test("minimized and hidden windows don't name it; an empty Desktop has none", () => {
    const windows = [win("net.imput.helium", 2, "minimized"), win("dev.dashi.terminal", 2, "hidden")];
    expect(autoName(2, windows, appName)).toBeNull();
    expect(autoName(3, windows, appName)).toBeNull();
  });

  test("two apps with the same name are named once", () => {
    expect(autoName(0, [win("foot", 0), win("dev.dashi.terminal", 0)], appName)).toBe("Terminal");
  });

  test("a given name wins; then the apps; then Desktop N", () => {
    const windows = [win("net.imput.helium", 1)];
    expect(spaceLabels(3, ["Work"], windows, appName)).toEqual(["Work", "Helium", "Desktop 3"]);
    expect(spaceLabels(2, [null, "Games"], [], appName)).toEqual(["Desktop 1", "Games"]);
  });

  test("windows without a Space are on the first", () => {
    const { space: _, ...noSpace } = win("net.imput.helium", 0);
    expect(autoName(0, [noSpace], appName)).toBe("Helium");
  });
});

describe("given names", () => {
  test("are tidied, cut, and empty means none", () => {
    expect(cleanName("  Deep   work ")).toBe("Deep work");
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("x".repeat(80))?.length).toBe(MAX_NAME);
  });

  test("renaming sets one and keeps the others; clearing goes back to automatic", () => {
    expect(renamed([], 2, "Games")).toEqual([null, null, "Games"]);
    expect(renamed(["Work", null, "Games"], 2, "")).toEqual(["Work"]);
    expect(renamed(["Work"], 0, "Home")).toEqual(["Home"]);
  });

  test("removing a Desktop moves the names after it down one", () => {
    expect(withoutSpace(["Work", "Mail", "Games"], 1)).toEqual(["Work", "Games"]);
    expect(withoutSpace(["Work", null, "Games"], 2)).toEqual(["Work"]);
  });

  test("settings.json's list is checked", () => {
    expect(parseSpaceNames(["Work", null, " Games "])).toEqual(["Work", null, "Games"]);
    expect(parseSpaceNames(["Work", 3])).toBeNull();
    expect(parseSpaceNames("Work")).toBeNull();
    expect(parseSpaceNames(Array.from({ length: 17 }, () => "x"))).toBeNull();
    const { settings, problems } = parseSettings({ spaces: { count: 2, names: ["Work", null] } });
    expect(settings.spaces.names).toEqual(["Work"]);
    expect(problems).toEqual([]);
    expect(parseSettings({ spaces: { names: [1] } }).problems).toEqual(["spaces.names must be a list of up to 16 names (or null)"]);
  });
});

describe("Move to, in the Window menu", () => {
  const focused = { ...win("net.imput.helium", 1), focused: true };
  const ctx = (labels: string[]): MenuContext => ({
    appName: "Helium",
    windows: [focused],
    focused,
    canLaunch: true,
    canOpenHelp: true,
    desktops: { labels, current: 1 },
  });
  const labelsOf = (context: MenuContext) =>
    buildMenu("window", context).flatMap((entry) => (entry.kind === "item" && entry.label.startsWith("Move to") ? [entry] : []));

  test("lists the other Desktops by name, then a new one", () => {
    const rows = labelsOf(ctx(["Work", "Helium", "Games"]));
    expect(rows.map((row) => row.label)).toEqual(["Move to Work", "Move to Games", "Move to New Desktop"]);
    expect(rows[1]?.action).toEqual({ kind: "move-to-space", window: focused.id, space: 2 });
    expect(rows[2]?.action).toEqual({ kind: "move-to-space", window: focused.id, space: "new" });
  });

  test("no new Desktop past the limit, and nothing without Desktops", () => {
    const sixteen = Array.from({ length: 16 }, (_, index) => `D${index}`);
    expect(labelsOf(ctx(sixteen)).at(-1)?.label).toBe("Move to D15");
    expect(labelsOf({ ...ctx([]), desktops: undefined })).toEqual([]);
  });
});
