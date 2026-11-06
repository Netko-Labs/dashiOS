import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { EditorModel } from "../apps/editor/model.ts";
import { DEFAULT_PREFS } from "../apps/editor/prefs.ts";
import { EditorWindow } from "../apps/editor/view.tsx";

// The window mounted on a stand-in for the Metal host: what it sends, and events sent back as the host would.
let dir = "";
let runtime: string | undefined;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-editor-view-"));
  // No menus socket here: the kit's menus client stays quiet.
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = dir;
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
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

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 30));

test("typing marks the document edited; the Save sheet saves it", async () => {
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
  expect(host.trees.at(-1)).toContain("Untitled — Edited");
  expect(host.trees.at(-1)).toContain("2 words");

  // Save on an Untitled document asks where.
  const save = root.nodeId("save");
  if (!save) throw new Error("no save button");
  host.emit({ type: "press", nodeId: save });
  await settle();
  const field = root.nodeId("save-sheet:path");
  if (!field) throw new Error("no Save As sheet");
  const path = join(dir, "hello.txt");
  host.emit({ type: "change", nodeId: field, value: path });
  await settle();
  host.emit({ type: "submit", nodeId: field, value: path });
  await settle();
  expect(readFileSync(path, "utf8")).toBe("hello there");
  expect(host.trees.at(-1)).toContain("hello.txt");
  expect(host.trees.at(-1)).not.toContain("— Edited");
  expect(root.nodeId("save-sheet:path")).toBeUndefined();
  root.unmount();
});

test("Save As asks once before replacing another file", async () => {
  const model = new EditorModel({ loadPrefs: () => DEFAULT_PREFS, savePrefs: () => {} });
  const host = fakeHost();
  const existing = join(dir, "taken.txt");
  writeFileSync(existing, "keep me");
  const root = render(
    <EditorWindow model={model} quit={() => {}} newWindow={() => {}} press={() => {}} scroll={() => {}} focusText={() => {}} setTitle={() => {}} />,
    host.transport,
  );
  await settle();
  model.edit("new text");
  host.emit({ type: "press", nodeId: root.nodeId("save") as string });
  await settle();
  const field = root.nodeId("save-sheet:path") as string;
  host.emit({ type: "change", nodeId: field, value: existing });
  await settle();
  host.emit({ type: "submit", nodeId: field, value: existing });
  await settle();
  expect(readFileSync(existing, "utf8")).toBe("keep me");
  expect(host.trees.at(-1)).toContain("already exists");
  host.emit({ type: "submit", nodeId: field, value: existing });
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
  const openWith = async (path: string): Promise<void> => {
    host.emit({ type: "press", nodeId: root.nodeId("open") as string });
    await settle();
    const field = root.nodeId("open-sheet:path") as string;
    host.emit({ type: "change", nodeId: field, value: path });
    await settle();
    host.emit({ type: "submit", nodeId: field, value: path });
    await settle();
  };
  await openWith(join(dir, "missing.txt"));
  expect(host.trees.at(-1)).toContain("There is no file there.");
  host.emit({ type: "press", nodeId: root.nodeId("open-sheet:cancel") as string });
  await settle();

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
  host.emit({ type: "press", nodeId: root.nodeId("open-sheet:cancel") as string });
  await settle();
  expect(root.nodeId("text")).toBe(input);
  expect(focused).toBe(2);

  // Esc in the Find field.
  host.emit({ type: "key", nodeId: root.nodeId("find") as string, value: "Escape" });
  await settle();
  expect(root.nodeId("text")).toBe(input);
  expect(focused).toBe(3);

  // Saving under another name renames the window; editing doesn't (the edited mark stays in the toolbar).
  model.edit("changed again");
  await settle();
  expect(titles).toEqual(["kept.txt"]);
  model.saveAs(join(dir, "renamed.txt"));
  await settle();
  expect(titles).toEqual(["kept.txt", "renamed.txt"]);
  root.unmount();
});
