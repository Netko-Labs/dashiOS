import { afterEach, expect, test } from "bun:test";
import { LauncherKeys } from "../src/launcher/keys.ts";
import type { LauncherProps } from "../src/launcher.tsx";
import { FILE_DELAY_MS } from "../src/launcher.tsx";
import { app, deferredFiles, file, mount as mountWith, settle, unmountLauncher } from "./launcher-harness.tsx";

// The launcher's wave 1 behavior, mounted on a stand-in for the Metal host (launcher-harness.tsx).

afterEach(unmountLauncher);

const TEAS = ["Tea Alpha", "Tea Bravo", "Tea Delta", "Tea Ember", "Tea Gamma"].map(app);
const TEA_FILES = ["tea-notes.md", "teapot.txt", "tea.csv"];

const mount = (props: Partial<LauncherProps> & Pick<LauncherProps, "entries">) => mountWith(props, CANDIDATES);

/** Every row id the tests look for. */
const CANDIDATES = [
  ...TEAS.map((entry) => `entry:${entry.id}`),
  ...TEAS.map((entry) => `failed:${entry.id}`),
  ...TEA_FILES.map((name) => `file:file:///home/alexk/${name}`),
  "answer",
  "files-off",
  "suggest:app.firefox",
  "search-files",
  "find-software",
  "entry:dev.dashi.files",
  "try:wi-fi",
  "try:files",
  "try:15% of 80",
  "try:dark mode",
  "all-apps",
];

test("bug 1: files landing late move nothing, and Enter opens the app that was highlighted", async () => {
  const files = deferredFiles();
  const launcher = await mount({ entries: TEAS, files });
  await launcher.type("tea");
  for (let i = 0; i < 3; i++) await launcher.key("ArrowDown");
  const before = launcher.rows();
  expect(before.selected).toBe("entry:app.tea-ember");

  // The files come in while the fourth app is highlighted.
  await settle(FILE_DELAY_MS + 20);
  expect(files.asked).toEqual(["tea"]);
  files.answer([file("tea-notes.md"), file("teapot.txt"), file("tea.csv")]);
  await settle();
  const after = launcher.rows();
  expect(after.ids.slice(0, before.ids.length)).toEqual(before.ids);
  expect(after.ids.length).toBe(before.ids.length + 3);
  expect(after.selected).toBe("entry:app.tea-ember");

  await launcher.enter();
  expect(launcher.opened).toEqual(["Tea Ember"]);
});

test("slots are held for files while the next answer comes, so the panel keeps its rows", async () => {
  const files = deferredFiles();
  const launcher = await mount({ entries: TEAS, files });
  await launcher.type("tea");
  await settle(FILE_DELAY_MS + 20);
  files.answer([file("tea-notes.md"), file("teapot.txt")]);
  await settle();
  expect(launcher.has("launcher:section:files")).toBe(true);
  await launcher.type("tea ");
  // Asked again for "tea " is the same words: nothing changes. A new word holds the slots.
  await launcher.type("tea b");
  expect(launcher.rows().ids).toEqual(["entry:app.tea-bravo"]);
  expect(launcher.has("launcher:section:files")).toBe(true);
});

test("↑ and ↓ wrap at both ends; the pointer over a row selects it; the compositor's keys move it too", async () => {
  const keys = new LauncherKeys();
  const launcher = await mount({ entries: TEAS, keys });
  await launcher.type("tea");
  await launcher.key("ArrowUp");
  expect(launcher.rows().selected).toBe("entry:app.tea-gamma");
  await launcher.key("ArrowDown");
  expect(launcher.rows().selected).toBe("entry:app.tea-alpha");
  await launcher.hover("entry:app.tea-delta");
  expect(launcher.rows().selected).toBe("entry:app.tea-delta");
  keys.binding("launcher-last");
  await settle();
  expect(launcher.rows().selected).toBe("entry:app.tea-gamma");
  keys.binding("launcher-first");
  await settle();
  expect(launcher.rows().selected).toBe("entry:app.tea-alpha");
  keys.binding("launcher-down");
  await settle();
  expect(launcher.rows().selected).toBe("entry:app.tea-bravo");
  await launcher.enter();
  expect(launcher.opened).toEqual(["Tea Bravo"]);
});

test("Esc clears the field first, then closes", async () => {
  const launcher = await mount({ entries: TEAS });
  await launcher.type("tea");
  await launcher.key("Escape");
  expect(launcher.closed).toEqual([]);
  // The field is empty again and full width, its own placeholder showing (Metal draws it after the caret).
  expect(launcher.tree()).toMatch(/"type":"input","props":\{[^}]*"value":"","placeholder":"An app, a setting, or a sum"[^}]*"flex":1/);
  await launcher.key("Escape");
  expect(launcher.closed).toEqual([1]);
});

test("bug 2: a sum is the first row, selected, and Enter copies it; no file search is asked", async () => {
  const files = deferredFiles();
  const copied: string[] = [];
  const launcher = await mount({
    entries: TEAS,
    files,
    copy: async (text) => {
      copied.push(text);
      return true;
    },
  });
  await launcher.type("2+2");
  expect(launcher.rows()).toEqual({ ids: ["answer"], selected: "answer" });
  await launcher.enter();
  expect(copied).toEqual(["4"]);
  await settle(FILE_DELAY_MS + 20);
  expect(files.asked).toEqual([]);
});

test("bug 3: nothing found offers a way forward", async () => {
  const entries = [app("Firefox"), { ...app("Files"), id: "dev.dashi.files" }, { ...app("Software"), id: "dev.dashi.software" }];
  const searched: string[] = [];
  const launcher = await mount({ entries, onSearchFiles: (query) => searched.push(query) });
  await launcher.type("fierfox");
  expect(launcher.has("launcher:section:nothing")).toBe(true);
  expect(launcher.rows().ids).toEqual(["suggest:app.firefox", "search-files", "find-software"]);
  await launcher.key("ArrowDown");
  await launcher.enter();
  expect(searched).toEqual(["fierfox"]);
});

test("an app that can't be started stays in the launcher as a row that tries again", async () => {
  let tries = 0;
  const launcher = await mount({
    entries: TEAS,
    onOpen: () => {
      tries += 1;
      return tries > 1;
    },
  });
  await launcher.type("tea alpha");
  await launcher.enter();
  expect(launcher.rows().selected).toBe("failed:app.tea-alpha");
  await launcher.enter();
  expect(tries).toBe(2);
});

test("with file search off the placeholder says so, and a row says file search is off", async () => {
  const off = await mount({ entries: TEAS, files: deferredFiles(false) });
  expect(off.tree()).toContain("An app, a setting, or a sum");
  await off.type("tea");
  expect(off.rows().ids).toContain("files-off");
  off.unmount();
  const on = await mount({ entries: TEAS, files: deferredFiles(true) });
  expect(on.tree()).toContain("An app, a setting, a file, or a sum");
});

test("a search that finds LocalSearch gone turns file search off, and the placeholder follows", async () => {
  const files = deferredFiles();
  const launcher = await mount({ entries: TEAS, files });
  await launcher.type("tea");
  await settle(FILE_DELAY_MS + 20);
  files.answer(null);
  await settle();
  expect(launcher.rows().ids).toContain("files-off");
  await launcher.key("Escape");
  expect(launcher.tree()).toContain("An app, a setting, or a sum");
});

test("the empty launcher teaches: examples that work here, then All apps, A to Z", async () => {
  const entries = [...TEAS, { ...app("Files"), id: "dev.dashi.files" }];
  const launcher = await mount({ entries });
  expect(launcher.rows().ids).toEqual(["try:files", "try:15% of 80", "all-apps"]);
  await launcher.enter();
  // An example types itself: the field now holds it, and its result is selected.
  expect(launcher.rows().ids).toEqual(["entry:dev.dashi.files"]);
  await launcher.key("Escape");
  await launcher.key("ArrowUp");
  await launcher.enter();
  expect(launcher.has("launcher:section:all")).toBe(true);
  expect(launcher.rows().ids[0]).toBe("entry:dev.dashi.files");
  await launcher.key("Escape");
  expect(launcher.has("launcher:section:try")).toBe(true);
});

test("the first file answer of an open finds its slots held: the panel doesn't grow when files arrive", async () => {
  const files = deferredFiles();
  const launcher = await mount({ entries: TEAS, files });
  await launcher.type("tea");
  // Before any answer, the files' head and their slots are already there.
  expect(launcher.has("launcher:section:files")).toBe(true);
  expect(launcher.rows().ids.some((id) => id.startsWith("file:"))).toBe(false);
  await settle(FILE_DELAY_MS + 20);
  files.answer([file("tea-notes.md"), file("teapot.txt"), file("tea.csv")]);
  await settle();
  expect(launcher.rows().ids.filter((id) => id.startsWith("file:"))).toHaveLength(3);
});

test("All apps reaches its last app: ↑ wraps to it, ↓ walks every one, the wheel scrolls, and typing still filters", async () => {
  // More apps than the panel has rows (it was cut after the 12th, so WhatsApp Web and the rest never showed).
  const names = [
    ...["1Password", "Activity Monitor", "Browser", "Calculator", "Calendar", "Components", "Deadlock", "Fedora Media Writer", "Files", "Htop"],
    ...["Notes", "NVIDIA X Server Settings", "Preview", "Screenshot", "Setup Assistant", "Software", "Steam", "System Settings"],
    ...["T3 Code (Nightly)", "Terminal", "Text Editor", "WhatsApp Web", "Wuthering Waves", "Zotero"],
  ];
  const entries = names.map(app);
  const ids = entries.map((entry) => `entry:${entry.id}`);
  const launcher = await mountWith({ entries }, [...ids, "all-apps", "try:files"]);
  await launcher.key("ArrowUp");
  await launcher.enter();
  expect(launcher.has("launcher:section:all")).toBe(true);
  // A window of eight is drawn, from the top.
  expect(launcher.rows().ids).toEqual(ids.slice(0, 8));
  // ↑ from the first wraps to the last: it is drawn, and selected.
  await launcher.key("ArrowUp");
  expect(launcher.rows()).toEqual({ ids: ids.slice(-8), selected: "entry:app.zotero" });
  // ↓ from the top visits every app once, in order.
  await launcher.key("ArrowDown");
  const visited: string[] = [];
  for (let step = 0; step < ids.length; step++) {
    visited.push(launcher.rows().selected as string);
    await launcher.key("ArrowDown");
  }
  expect(visited).toEqual(ids);
  // Back at the first, the wheel scrolls down to the end too, a row a line.
  expect(launcher.rows().selected).toBe(ids[0] ?? null);
  await launcher.emit({ type: "wheel", nodeId: launcher.node("launcher:list"), dx: 0, dy: -(ids.length - 1) });
  expect(launcher.rows()).toEqual({ ids: ids.slice(-8), selected: "entry:app.zotero" });
  // Typing still filters, past the window.
  await launcher.type("whats");
  expect(launcher.rows().ids[0]).toBe("entry:app.whatsapp-web");
});
