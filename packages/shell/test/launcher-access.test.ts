import { expect, test } from "bun:test";
import { TEXT_SIZES } from "@dashi/ui";
import { KEYMAP } from "../src/keymap.ts";
import { fieldAccess, rowAccess, spokenRow } from "../src/launcher/access.ts";
import type { LauncherWindow } from "../src/launcher/items.ts";
import { LauncherKeys, withLauncher } from "../src/launcher/keys.ts";
import { measuresFor, STANDARD, SURFACE, tallest } from "../src/launcher/measures.ts";
import {
  arrowsWanted,
  launcherOrigin,
  openPictures,
  pictureRect,
  picturesOnScreen,
  picturesToSend,
  rowWindows,
  sameRects,
  stepPictures,
  trimForPictures,
} from "../src/launcher/pictures.ts";
import type { Row } from "../src/launcher/rows.ts";
import { textSizeCommands } from "../src/text-size.ts";

// Newcomers and access (docs/betterments.html): text size, the screen reader's words, and the windows' live pictures.

test("at text size 1 the launcher keeps wave 1's measures and rows", () => {
  expect(STANDARD).toMatchObject({
    field: 48,
    fieldText: 17,
    row: 40,
    head: 22,
    icon: 28,
    title: 13,
    detail: 12,
    small: 11,
    localRows: 5,
    fileRows: 3,
    allAppsRows: 8,
  });
});

test("bigger text grows every row and lists fewer, so the most it lists always fits the surface", () => {
  let last = STANDARD;
  for (const size of TEXT_SIZES) {
    const m = measuresFor(size);
    expect(m.row).toBeGreaterThanOrEqual(last.row);
    expect(m.fieldText).toBe(Math.round(17 * size));
    expect(m.localRows).toBeGreaterThanOrEqual(3);
    expect(m.fileRows).toBeGreaterThanOrEqual(1);
    // The tallest the results get, and the tallest plain list (a head and its rows), both fit under the field.
    expect(tallest(m.localRows, m.fileRows, m.row, m.head)).toBeLessThanOrEqual(m.room);
    expect(m.head + m.listRows * m.row).toBeLessThanOrEqual(m.room);
    expect(m.field + 3 + 10 + m.room).toBe(SURFACE.height);
    last = m;
  }
  expect(measuresFor(1.5).localRows + measuresFor(1.5).fileRows).toBeLessThan(8);
});

test("text size reaches GTK apps through gsettings, when it is there", () => {
  expect(textSizeCommands(1.3, () => true)).toEqual([["gsettings", "set", "org.gnome.desktop.interface", "text-scaling-factor", "1.3"]]);
  expect(textSizeCommands(1.3, () => false)).toEqual([]);
});

const wifi: Row = {
  id: "action:dashi://settings/network/wi-fi",
  title: "Wi-Fi",
  detail: "Home-5G",
  kind: "Settings",
  icon: { none: true },
  action: { kind: "all-apps" },
  control: { kind: "switch", on: true },
};

test("a screen reader hears each row as it reads: name, state, kind, and where it is in the list", () => {
  expect(spokenRow(wifi, 1, 3)).toBe("Wi-Fi, on, setting, 1 of 3");
  const terminal: Row = { id: "entry:term", title: "Terminal", detail: "3 windows", kind: "App", icon: { none: true }, action: { kind: "all-apps" } };
  expect(spokenRow(terminal, 2, 3)).toBe("Terminal, 3 windows, app, 2 of 3");
  const answer: Row = {
    id: "answer",
    title: "12",
    detail: "15% of 80 =",
    kind: "Answer",
    icon: { none: true },
    action: { kind: "copy", text: "12" },
    strong: true,
  };
  expect(spokenRow(answer, 1, 1)).toBe("15% of 80 equals 12, Return copies, 1 of 1");
  expect(spokenRow({ ...answer, kind: "Copied" }, 1, 1)).toBe("15% of 80 equals 12, Copied, 1 of 1");
  expect(rowAccess(wifi, 1, 3, true)).toEqual({
    accessibilityRole: "option",
    accessibilityLabel: "Wi-Fi, on, setting, 1 of 3",
    accessibilityState: { selected: true },
  });
  expect(fieldAccess("An app, a setting, or a sum", true).accessibilityRole).toBe("combobox");
});

const windows: LauncherWindow[] = [
  { id: 7, address: "dashi://window/w7", title: "~", appName: "Terminal", entryId: "app.terminal", state: "normal", icon: "/t.svg" },
  { id: 8, address: "dashi://window/w8", title: "build", appName: "Terminal", entryId: "app.terminal", state: "minimized", icon: "/t.svg" },
  { id: 9, address: "dashi://window/w9", title: "Notes", appName: "Notes", entryId: "app.notes", state: "normal", icon: "/n.svg" },
];

test("a row's windows: an app's own, a window row its window, others none", () => {
  const entry = { id: "app.terminal", name: "Terminal", icon: "/t.svg", keywords: [], exec: ["true"] };
  const app: Row = { id: "entry:app.terminal", title: "Terminal", kind: "App", icon: { none: true }, action: { kind: "open", entry } };
  expect(rowWindows(app, windows).map((each) => each.id)).toEqual([7, 8]);
  const window: Row = {
    id: "window:9",
    title: "Notes",
    kind: "Window",
    icon: { none: true },
    action: { kind: "focus", window: windows[2] as LauncherWindow },
    group: "window",
  };
  expect(rowWindows(window, windows).map((each) => each.id)).toEqual([9]);
  expect(rowWindows(wifi, windows)).toEqual([]);
  expect(rowWindows(undefined, windows)).toEqual([]);
});

test("→ opens the pictures, ← → step, ← past the first folds; another row folds them", () => {
  expect(arrowsWanted(null, false)).toBe("none");
  expect(arrowsWanted(null, true)).toBe("open");
  const open = { rowId: "entry:a", at: 0 };
  expect(arrowsWanted(open, true)).toBe("browse");
  expect(stepPictures(open, 2, 1)).toEqual({ rowId: "entry:a", at: 1 });
  expect(stepPictures({ rowId: "entry:a", at: 1 }, 2, 1)).toEqual({ rowId: "entry:a", at: 1 });
  expect(stepPictures(open, 2, -1)).toBeNull();
  expect(openPictures(open, "entry:b", 2)).toBeNull();
  expect(openPictures({ rowId: "entry:a", at: 5 }, "entry:a", 2)).toEqual({ rowId: "entry:a", at: 1 });
  expect(openPictures(open, "entry:a", 0)).toBeNull();
});

test("pictures go where their frames were laid out, inset, on the launcher's screen; the same rects aren't sent twice", () => {
  const frames = new Map([
    [7, { x: 54, y: 103, width: 112, height: 70 }],
    [8, { x: 174, y: 103, width: 112, height: 70 }],
  ]);
  expect(picturesToSend([7, 8, 9], frames)).toBeNull();
  const rects = picturesToSend([7, 8], frames) ?? [];
  expect(rects[0]).toEqual({ window: 7, x: 57, y: 106, w: 106, h: 64 });
  expect(sameRects(rects, picturesToSend([7, 8], frames) ?? [])).toBe(true);
  expect(sameRects(null, rects)).toBe(false);
  expect(pictureRect(1, { x: 0, y: 0, width: 4, height: 4 })).toBeNull();
  const origin = launcherOrigin({ x: 1920, y: 32, width: 1600 }, 620, 120);
  expect(origin).toEqual({ x: 2410, y: 152 });
  expect(picturesOnScreen(rects, origin)[1]).toEqual({ window: 8, x: 2587, y: 258, w: 106, h: 64 });
});

test("→ and ← are the launcher's only while pictures can show; the keymap says so", () => {
  const keys = new LauncherKeys();
  const heard: string[] = [];
  keys.onArrows = (want) => heard.push(want);
  keys.arrows("open");
  keys.arrows("open");
  keys.arrows("browse");
  expect(heard).toEqual(["open", "browse"]);
  const whens = (arrows: "none" | "open" | "browse") => withLauncher(KEYMAP, false, arrows).rules.map((rule) => rule.when);
  expect(whens("none")).not.toContain("Right");
  expect(whens("open")).toContain("Right");
  expect(whens("open")).not.toContain("Left");
  expect(whens("browse")).toContain("Left");
  const commands: string[] = [];
  keys.subscribeCommands((command) => commands.push(command.kind === "arrow" ? command.to : command.kind));
  expect(keys.binding("launcher-right")).toBe(true);
  expect(keys.binding("launcher-left")).toBe(true);
  expect(commands).toEqual(["right", "left"]);
});

test("with a row's pictures open, the rows after it give way from the bottom; the open row and those above stay", () => {
  const rows = (ids: string[]) => ids.map((id) => ({ id }));
  const sections = [
    { title: "Top hit", rows: rows(["a"]) },
    { title: "Apps", rows: rows(["b", "c"]) },
    { title: "Files", rows: rows(["f1", "f2", "f3"]) },
  ];
  const m = { room: 310, row: 40, head: 22 };
  expect(trimForPictures(sections, m, null)).toEqual(sections);
  // 310 − 82 for the pictures = 228: three heads and four rows (226) fit, a fifth row would not.
  const trimmed = trimForPictures(sections, m, "b");
  expect(trimmed.map((section) => section.rows.map((row) => row.id))).toEqual([["a"], ["b", "c"], ["f1"]]);
  // Slots held for files shrink too, and a head with nothing under it goes.
  const waiting = [
    { title: "Apps", rows: rows(["b"]) },
    { title: "Files", rows: [], reserved: 3 },
  ];
  expect(trimForPictures(waiting, { room: 240, row: 40, head: 22 }, "b")).toEqual([
    { title: "Apps", rows: rows(["b"]) },
    { title: "Files", rows: [], reserved: 1 },
  ]);
  expect(trimForPictures(waiting, { room: 200, row: 40, head: 22 }, "b")).toEqual([{ title: "Apps", rows: rows(["b"]) }]);
});
