import { afterEach, expect, test } from "bun:test";
import { lightColors } from "@dashi/ui";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { Entry } from "../src/entries.ts";
import { LauncherKeys } from "../src/launcher/keys.ts";
import type { FileRow } from "../src/launcher/rows.ts";
import { FILE_DELAY_MS, Launcher, type LauncherFiles, type LauncherProps } from "../src/launcher.tsx";

// The launcher mounted on a stand-in for the Metal host: typing, keys and the
// pointer sent as the host sends them, what it draws read back from the tree.

const settle = (ms = 10): Promise<void> => new Promise((done) => setTimeout(done, ms));

const app = (name: string): Entry => ({ id: `app.${name.toLowerCase().replaceAll(" ", "-")}`, name, icon: "/icon.svg", keywords: [], exec: ["true"] });
const file = (name: string): FileRow => ({
  url: `file:///home/alexk/${name}`,
  path: `/home/alexk/${name}`,
  name,
  folder: "~",
  mime: "text/plain",
  icon: "/file.svg",
});

interface Node {
  testID?: string;
  props?: Record<string, unknown>;
  style?: Record<string, unknown>;
  children?: Node[];
  [key: string]: unknown;
}

/** Files that answer when the test says. */
function deferredFiles(available = true): LauncherFiles & { answer(rows: FileRow[] | null): void; asked: string[] } {
  let resolve: ((rows: FileRow[] | null) => void) | null = null;
  const asked: string[] = [];
  return {
    asked,
    isAvailable: () => available,
    find: (query) => {
      asked.push(query);
      return new Promise((done) => {
        resolve = done;
      });
    },
    answer: (rows) => resolve?.(rows),
  };
}

let mounted: NativeRoot | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

async function mount(props: Partial<LauncherProps> & Pick<LauncherProps, "entries">) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const opened: string[] = [];
  const closed: number[] = [];
  const root = render(
    <Launcher
      onOpen={(entry) => {
        opened.push(entry.name);
        return true;
      }}
      onClose={() => closed.push(1)}
      {...props}
    />,
    transport,
  );
  mounted = root;
  const emit = async (event: NativeEvent): Promise<void> => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  const type = (value: string) => emit({ type: "change", nodeId: node("launcher:field"), value });
  const key = (value: "Escape" | "ArrowUp" | "ArrowDown") => emit({ type: "key", nodeId: node("launcher:field"), value });
  const enter = () => emit({ type: "submit", nodeId: node("launcher:field"), value: "" });
  const hover = (rowId: string) => emit({ type: "hover", nodeId: node(`launcher:row:${rowId}`), hovered: true });
  /** Which of `candidates` are drawn as rows, top to bottom, and which one wears the selection. */
  const rows = (candidates: readonly string[] = CANDIDATES): { ids: string[]; selected: string | null } => {
    // The tree carries native ids; the rows are found by theirs.
    const byNative = new Map(
      candidates.flatMap((id) => (root.nodeId(`launcher:row:${id}`) ? [[root.nodeId(`launcher:row:${id}`) as string, id] as const] : [])),
    );
    const ids: string[] = [];
    let selected: string | null = null;
    const walk = (at: unknown): void => {
      if (!at || typeof at !== "object") return;
      const each = at as Node;
      const native = (each.id ?? each.props?.id) as string | undefined;
      const row = native === undefined ? undefined : byNative.get(native);
      if (row !== undefined && !ids.includes(row)) {
        ids.push(row);
        // The wash is the row's own background, not a child's.
        if ((each.background ?? each.props?.background) === lightColors.selectionWash) selected = row;
      }
      for (const value of Object.values(each)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") walk(value);
      }
    };
    walk(JSON.parse(root.lastTree() ?? "null"));
    return { ids, selected };
  };
  const has = (testID: string): boolean => root.nodeId(testID) !== undefined;
  const tree = (): string => root.lastTree() ?? "";
  const unmount = () => {
    root.unmount();
    mounted = null;
  };
  await settle();
  return { opened, closed, type, key, enter, hover, rows, has, tree, unmount, emit, node };
}

const TEAS = ["Tea Alpha", "Tea Beta", "Tea Delta", "Tea Epsilon", "Tea Gamma"].map(app);
const TEA_FILES = ["tea-notes.md", "teapot.txt", "tea.csv"];

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
  expect(before.selected).toBe("entry:app.tea-epsilon");

  // The files come in while the fourth app is highlighted.
  await settle(FILE_DELAY_MS + 20);
  expect(files.asked).toEqual(["tea"]);
  files.answer([file("tea-notes.md"), file("teapot.txt"), file("tea.csv")]);
  await settle();
  const after = launcher.rows();
  expect(after.ids.slice(0, before.ids.length)).toEqual(before.ids);
  expect(after.ids.length).toBe(before.ids.length + 3);
  expect(after.selected).toBe("entry:app.tea-epsilon");

  await launcher.enter();
  expect(launcher.opened).toEqual(["Tea Epsilon"]);
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
  expect(launcher.rows().ids).toEqual(["entry:app.tea-beta"]);
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
  expect(launcher.rows().selected).toBe("entry:app.tea-beta");
  await launcher.enter();
  expect(launcher.opened).toEqual(["Tea Beta"]);
});

test("Esc clears the field first, then closes", async () => {
  const launcher = await mount({ entries: TEAS });
  await launcher.type("tea");
  await launcher.key("Escape");
  expect(launcher.closed).toEqual([]);
  expect(launcher.has("launcher:placeholder")).toBe(true);
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
