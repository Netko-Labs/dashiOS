import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { EditorModel } from "../apps/editor/model.ts";
import { DEFAULT_PREFS } from "../apps/editor/prefs.ts";
import { EditorWindow } from "../apps/editor/view.tsx";
import { settle } from "./support/time.ts";

// The window mounted on a stand-in for the Metal host: what it sends, and events sent back as the host would.
let dir = "";
let runtime: string | undefined;
let home: string | undefined;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-editor-view-"));
  // Save As starts in Documents, as a new document's does.
  mkdirSync(join(dir, "Documents"));
  // No menus socket here: the kit's menus client stays quiet.
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = dir;
  // Open and Save As are Files' chooser, which starts at home: home is the scratch folder.
  home = process.env.HOME;
  process.env.HOME = dir;
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
  if (home === undefined) delete process.env.HOME;
  else process.env.HOME = home;
  rmSync(dir, { recursive: true, force: true });
});

function fakeHost() {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const emit = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  return { transport, trees, emit };
}
const press = (nodeId: string): NativeEvent => ({ type: "press", nodeId });

test("an Untitled document is a draft, counted once typing pauses; the Save sheet saves it", async () => {
  const model = new EditorModel({ loadPrefs: () => DEFAULT_PREFS, savePrefs: () => {} });
  const host = fakeHost();
  const quits: boolean[] = [];
  const root = render(
    <EditorWindow
      model={model}
      quit={(discard) => quits.push(discard)}
      newWindow={() => {}}
      press={() => {}}
      scroll={() => {}}
      focusText={() => {}}
      setTitle={() => {}}
    />,
    host.transport,
  );
  // Dashi's unified title bar: the toolbar shows the document's name.
  host.emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 28 } });
  await settle();
  expect(host.trees.at(-1)).toContain("Untitled");

  const text = root.nodeId("text");
  if (!text) throw new Error("no text input");
  host.emit({ type: "change", nodeId: text, value: "hello there" });
  await settle();
  expect(model.getSnapshot().text).toBe("hello there");
  // The title row keeps the name and "Draft"; the counts wait in the chip at the text's foot (review 54).
  expect(host.trees.at(-1)).toContain(' — Draft"');
  expect(host.trees.at(-1)).toContain("1 line · 0 words");
  expect(root.nodeId("counts")).toBeDefined();
  // The chip ends on the toolbar's right edge (paddingRight 12), under Find.
  expect(host.trees.at(-1)).toMatch(new RegExp(`"id":"${root.nodeId("counts")}"[^}]*"absolute":true,"right":12,`));
  expect(host.trees.at(-1)).toContain('"paddingRight":12,"borderBottom":1,"height":38');
  await new Promise((done) => setTimeout(done, 350));
  expect(host.trees.at(-1)).toContain("1 line · 2 words");

  // Save on an Untitled document asks where: Files' chooser, in the home folder, the name ready.
  const save = root.nodeId("save");
  if (!save) throw new Error("no save button");
  host.emit({ type: "press", nodeId: save });
  await settle(80);
  const field = root.nodeId("chooser:name");
  if (!field) throw new Error("no Save As chooser");
  expect(host.trees.at(-1)).toContain("Untitled.txt");
  const path = join(dir, "Documents", "hello.txt");
  host.emit({ type: "change", nodeId: field, value: "hello.txt" });
  await settle();
  host.emit({ type: "submit", nodeId: field, value: "hello.txt" });
  await settle();
  expect(readFileSync(path, "utf8")).toBe("hello there");
  expect(host.trees.at(-1)).toContain("hello.txt");
  expect(host.trees.at(-1)).not.toContain("Draft");
  expect(root.nodeId("chooser:name")).toBeUndefined();
  root.unmount();
});

test("Save As asks before replacing another file, with Replace in ume", async () => {
  const model = new EditorModel({ loadPrefs: () => DEFAULT_PREFS, savePrefs: () => {} });
  const host = fakeHost();
  const existing = join(dir, "Documents", "taken.txt");
  writeFileSync(existing, "keep me");
  const root = render(
    <EditorWindow model={model} quit={() => {}} newWindow={() => {}} press={() => {}} scroll={() => {}} focusText={() => {}} setTitle={() => {}} />,
    host.transport,
  );
  await settle();
  model.edit("new text");
  await settle();
  host.emit({ type: "press", nodeId: root.nodeId("save") as string });
  await settle();
  await settle(50);
  const field = root.nodeId("chooser:name") as string;
  host.emit({ type: "change", nodeId: field, value: "taken.txt" });
  await settle();
  host.emit({ type: "submit", nodeId: field, value: "taken.txt" });
  await settle();
  expect(readFileSync(existing, "utf8")).toBe("keep me");
  expect(host.trees.at(-1)).toContain("already exists");
  host.emit(press(root.nodeId("chooser:replace:ok") as string));
  await settle();
  expect(readFileSync(existing, "utf8")).toBe("new text");
  root.unmount();
});

test("Open takes an untouched window's place, and opens another window otherwise", async () => {
  const model = new EditorModel({ loadPrefs: () => DEFAULT_PREFS, savePrefs: () => {} });
  const host = fakeHost();
  const opened: (readonly string[])[] = [];
  const first = join(dir, "first.txt");
  const second = join(dir, "second.txt");
  writeFileSync(first, "one");
  writeFileSync(second, "two");
  const root = render(
    <EditorWindow
      model={model}
      quit={() => {}}
      newWindow={(files) => opened.push(files)}
      press={() => {}}
      scroll={() => {}}
      focusText={() => {}}
      setTitle={() => {}}
    />,
    host.transport,
  );
  await settle();
  // Open is Files' chooser: Home in its sidebar, the file's icon, then Open.
  const openWith = async (path: string): Promise<void> => {
    host.emit({ type: "press", nodeId: root.nodeId("open") as string });
    await settle(60);
    host.emit(press(root.nodeId("place:home") as string));
    await settle(60);
    host.emit(press(root.nodeId(`item:${path}`) as string));
    await settle();
    host.emit(press(root.nodeId("chooser:accept") as string));
    await settle();
  };
  host.emit({ type: "press", nodeId: root.nodeId("open") as string });
  await settle(60);
  host.emit(press(root.nodeId("chooser:cancel") as string));
  await settle();
  expect(root.nodeId("chooser:cancel")).toBeUndefined();

  await openWith(first);
  expect(model.getSnapshot()).toMatchObject({ path: first, text: "one" });
  expect(opened).toEqual([]);
  await openWith(second);
  expect(model.getSnapshot().path).toBe(first);
  expect(opened).toEqual([[second]]);
  root.unmount();
});

test("the text keeps its input (and its caret) through Save, closing a sheet, and Esc in Find; the window is named after its document", async () => {
  const model = new EditorModel({ loadPrefs: () => DEFAULT_PREFS, savePrefs: () => {} });
  const path = join(dir, "kept.txt");
  writeFileSync(path, "first");
  model.open(path);
  const host = fakeHost();
  const titles: string[] = [];
  let focused = 0;
  const root = render(
    <EditorWindow
      model={model}
      quit={() => {}}
      newWindow={() => {}}
      press={() => {}}
      scroll={() => {}}
      focusText={() => focused++}
      setTitle={(title) => titles.push(title)}
    />,
    host.transport,
  );
  await settle();
  expect(titles).toEqual(["kept.txt"]);
  const input = root.nodeId("text");
  if (!input) throw new Error("no text input");

  host.emit({ type: "change", nodeId: input, value: "first, then more" });
  await settle();
  // Save from the toolbar: written, and the same input takes the keyboard back.
  host.emit({ type: "press", nodeId: root.nodeId("save") as string });
  await settle();
  expect(readFileSync(path, "utf8")).toBe("first, then more");
  expect(root.nodeId("text")).toBe(input);
  expect(focused).toBe(1);

  // A sheet comes and goes.
  host.emit({ type: "press", nodeId: root.nodeId("open") as string });
  await settle();
  await settle(60);
  host.emit(press(root.nodeId("chooser:cancel") as string));
  await settle();
  expect(root.nodeId("text")).toBe(input);
  expect(focused).toBe(2);

  // Esc in the Find field.
  host.emit({ type: "key", nodeId: root.nodeId("find") as string, value: "Escape" });
  await settle();
  expect(root.nodeId("text")).toBe(input);
  expect(focused).toBe(3);

  // Saving under another name renames the window; editing doesn't.
  model.edit("changed again");
  await settle();
  expect(titles).toEqual(["kept.txt"]);
  model.saveAs(join(dir, "renamed.txt"));
  await settle();
  expect(titles).toEqual(["kept.txt", "renamed.txt"]);
  root.unmount();
});

type InputProps = {
  id: string;
  highlights?: { start: number; end: number; color: string }[];
  selection?: { start: number; end: number };
  lineNumbers?: unknown;
};
type Node = { type: string; props: InputProps; children?: unknown[] };

/** The props of input `id` in the latest tree. */
function inputProps(tree: string | undefined, id: string | undefined): InputProps | null {
  const find = (node: Node): InputProps | null => {
    if (node.type === "input" && node.props.id === id) return node.props;
    for (const child of node.children ?? []) {
      const found = typeof child === "object" && child !== null ? find(child as Node) : null;
      if (found) return found;
    }
    return null;
  };
  return find(JSON.parse(tree ?? "{}") as Node);
}

test("Find washes every match and selects the one it is on; the caret is held; line numbers are on", async () => {
  const model = new EditorModel({ loadPrefs: () => DEFAULT_PREFS, savePrefs: () => {} });
  model.edit("one two\none three\none");
  const host = fakeHost();
  const root = render(
    <EditorWindow model={model} quit={() => {}} newWindow={() => {}} press={() => {}} scroll={() => {}} focusText={() => {}} setTitle={() => {}} />,
    host.transport,
  );
  host.emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 28 } });
  await settle();
  const text = (): InputProps | null => inputProps(host.trees.at(-1), root.nodeId("text"));
  expect(text()?.lineNumbers).toMatchObject({ color: "#1d1d1fa6" });
  expect(text()?.highlights).toBeUndefined();

  const field = root.nodeId("find") as string;
  host.emit({ type: "change", nodeId: field, value: "one" });
  await settle();
  expect(text()?.highlights).toEqual([
    { start: 0, end: 3, color: "#E5B13F40" },
    { start: 8, end: 11, color: "#E5B13F40" },
    { start: 18, end: 21, color: "#E5B13F40" },
  ]);
  host.emit({ type: "submit", nodeId: field, value: "one" });
  await settle();
  host.emit({ type: "submit", nodeId: field, value: "one" });
  await settle();
  expect(text()?.highlights?.[1]).toEqual({ start: 8, end: 11, color: "#E5B13F99" });
  expect(text()?.selection).toEqual({ start: 8, end: 11 });
  // Find's place is in its field, short enough for it.
  expect(root.nodeId("find:status")).toBeDefined();
  expect(host.trees.at(-1)).toContain("2 of 3");
  expect(host.trees.at(-1)).not.toContain("line 2");

  // Where the input says the caret went is where it stays, through Undo's new text.
  host.emit({ type: "selection", nodeId: root.nodeId("text") as string, start: 4, end: 4 });
  await settle();
  expect(text()?.selection).toEqual({ start: 4, end: 4 });
  model.edit("one two\none three\none!");
  model.undo();
  await settle();
  expect(text()?.selection).toEqual({ start: 4, end: 4 });
  root.unmount();
});

test("one Esc leaves Find: the query stays, the text takes the keyboard on the current match", async () => {
  const model = new EditorModel({ loadPrefs: () => DEFAULT_PREFS, savePrefs: () => {} });
  model.edit("one two\none three\none");
  const host = fakeHost();
  let focused = 0;
  const root = render(
    <EditorWindow model={model} quit={() => {}} newWindow={() => {}} press={() => {}} scroll={() => {}} focusText={() => focused++} setTitle={() => {}} />,
    host.transport,
  );
  await settle();
  const text = (): InputProps | null => inputProps(host.trees.at(-1), root.nodeId("text"));
  const field = root.nodeId("find") as string;
  host.emit({ type: "change", nodeId: field, value: "one" });
  await settle();
  // Typed, never stepped: Esc selects the first match.
  host.emit({ type: "key", nodeId: field, value: "Escape" });
  await settle();
  expect(focused).toBe(1);
  expect(model.getSnapshot().find.query).toBe("one");
  expect(text()?.selection).toEqual({ start: 0, end: 3 });
  // Stepped to the second: Esc keeps it, and ❖G goes on from there.
  host.emit({ type: "submit", nodeId: field, value: "one" });
  await settle();
  expect(text()?.selection).toEqual({ start: 8, end: 11 });
  host.emit({ type: "key", nodeId: field, value: "Escape" });
  await settle();
  expect(focused).toBe(2);
  expect(text()?.selection).toEqual({ start: 8, end: 11 });
  expect(text()?.highlights).toHaveLength(3);
  expect(model.getSnapshot().find.query).toBe("one");
  root.unmount();
});
