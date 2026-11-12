import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@mirinjs/metal";
import { EditorModel } from "../apps/editor/lib/model.ts";
import { DEFAULT_PREFS } from "../apps/editor/lib/prefs.ts";
import { EditorWindow } from "../apps/editor/lib/views/view.tsx";
import { fakeHost, press, scratchHome } from "./support/editor-view.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

fakeClockEachTest();

const scratch = scratchHome();

test("the text keeps its input (and its caret) through Save, closing a sheet, and Esc in Find; the window is named after its document", async () => {
  const model = new EditorModel({ loadPrefs: () => DEFAULT_PREFS, savePrefs: () => {} });
  const path = join(scratch.dir, "kept.txt");
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
  model.saveAs(join(scratch.dir, "renamed.txt"));
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

test("Tab types a tab in the document instead of moving the keyboard to the toolbar", async () => {
  const model = new EditorModel({ loadPrefs: () => DEFAULT_PREFS, savePrefs: () => {} });
  const host = fakeHost();
  const root = render(
    <EditorWindow model={model} quit={() => {}} newWindow={() => {}} press={() => {}} scroll={() => {}} focusText={() => {}} setTitle={() => {}} />,
    host.transport,
  );
  await settle();
  const id = root.nodeId("text");
  type Node = { type: string; props: { id?: string; insertTab?: boolean }; children?: Node[] };
  const find = (node: Node): Node | null => (node.props?.id === id ? node : ((node.children ?? []).map(find).find(Boolean) ?? null));
  expect(find(JSON.parse(host.trees.at(-1) ?? "{}") as Node)?.props.insertTab).toBe(true);
  root.unmount();
});
