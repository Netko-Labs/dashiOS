/**
 * ❖N in Notes: the new note's title takes the typing that follows, also when
 * the note that was open was an empty "Untitled" that leaving it discarded,
 * so the new note gets the very same file name (review 33).
 */

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { NotesModel } from "../apps/notes/lib/model.ts";
import { NotesWindow } from "../apps/notes/lib/views/view.tsx";
import { NotesStore } from "../src/shared/notes/store.ts";
import { settle } from "./support/time.ts";

let runtime: string | undefined;
let scratch = "";
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "dashi-notes-new-run-"));
  // No menus socket here: the kit's menus client stays quiet.
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = scratch;
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
  rmSync(scratch, { recursive: true, force: true });
});

let root = "";
let store: NotesStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dashi-notes-new-"));
  store = new NotesStore(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

type Node = { type: string; props: { id?: string; autofocus?: boolean; value?: string }; children?: unknown[] };

/** The inputs of the latest tree, by id. */
function inputs(tree: string | undefined): Map<string, Node["props"]> {
  const found = new Map<string, Node["props"]>();
  const walk = (node: Node): void => {
    if (node.type === "input" && node.props.id) found.set(node.props.id, node.props);
    for (const child of node.children ?? []) if (typeof child === "object" && child !== null) walk(child as Node);
  };
  walk(JSON.parse(tree ?? "{}") as Node);
  return found;
}

function mount(model: NotesModel) {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const window = render(<NotesWindow model={model} host={{ scroll: () => {}, press: () => {}, openLink: () => {} }} />, transport);
  for (const listener of listeners) listener({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 28 } });
  const title = () => {
    const id = window.nodeId("title");
    return { id, props: id ? inputs(trees.at(-1)).get(id) : undefined };
  };
  return { window, title };
}

test("❖N over an empty Untitled note: a new note, its title a new field that takes the keyboard", async () => {
  // As 32 left it: an empty Untitled.md (one newline), open.
  writeFileSync(join(root, "Untitled.md"), "\n");
  store.create({ title: "Groceries", body: "eggs" });
  const model = new NotesModel(store, 60_000);
  model.select("Untitled.md");
  const { window, title } = mount(model);
  await settle();
  const before = title();
  const session = model.getSnapshot().session;

  model.newNote();
  await settle();

  const state = model.getSnapshot();
  // The empty note was discarded and the new one took its name.
  expect(state.selected).toBe("Untitled.md");
  expect(
    readdirSync(root)
      .filter((name) => name.endsWith(".md"))
      .sort(),
  ).toEqual(["Groceries.md", "Untitled.md"]);
  expect(state.focusTitle).toBe(true);
  expect(state.session).toBeGreaterThan(session);
  const after = title();
  expect(after.id).not.toBe(before.id);
  expect(after.props?.autofocus).toBe(true);
  window.unmount();
  model.dispose();
});

test("❖N twice: each new note's title takes the keyboard", async () => {
  store.create({ title: "Groceries", body: "eggs" });
  const model = new NotesModel(store, 60_000);
  model.select("Groceries.md");
  const { window, title } = mount(model);
  await settle();
  model.newNote();
  await settle();
  const first = title();
  expect(first.props?.autofocus).toBe(true);
  model.newNote();
  await settle();
  const second = title();
  expect(second.id).not.toBe(first.id);
  expect(second.props?.autofocus).toBe(true);
  expect(model.getSnapshot().focusTitle).toBe(true);
  window.unmount();
  model.dispose();
});
