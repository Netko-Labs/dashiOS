import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { NotesModel } from "../apps/notes/model.ts";
import { NotesStore } from "../apps/notes/store.ts";
import { NotesWindow } from "../apps/notes/view.tsx";

// The window on a stand-in for the Metal host: the trees it was sent, and events sent back as the host would.
let runtime: string | undefined;
let scratch = "";
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "dashi-notes-view-run-"));
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
  root = mkdtempSync(join(tmpdir(), "dashi-notes-view-"));
  store = new NotesStore(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

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

const settle = (ms = 30): Promise<void> => new Promise((done) => setTimeout(done, ms));

type Props = { id?: string; autofocus?: boolean; selection?: { start: number; end: number } };
type Node = { type: string; props: Props; children?: unknown[] };

/** The props of input `id` in the latest tree. */
function inputProps(tree: string | undefined, id: string | undefined): Props | null {
  const find = (node: Node): Props | null => {
    if (node.type === "input" && node.props.id === id) return node.props;
    for (const child of node.children ?? []) {
      const found = typeof child === "object" && child !== null ? find(child as Node) : null;
      if (found) return found;
    }
    return null;
  };
  return find(JSON.parse(tree ?? "{}") as Node);
}

function mount(model: NotesModel) {
  const host = fakeHost();
  const window = render(<NotesWindow model={model} host={{ scroll: () => {}, press: () => {}, openLink: () => {} }} />, host.transport);
  host.emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 28 } });
  return { host, window, body: (): Props | null => inputProps(host.trees.at(-1), window.nodeId("body")) };
}

test("one Esc in Find keeps the words and hands the keyboard to the note, on the match", async () => {
  store.create({ title: "Groceries", body: "eggs, then milk" });
  const model = new NotesModel(store, 60_000);
  model.select("Groceries.md");
  const { host, window, body } = mount(model);
  await settle();
  const search = window.nodeId("search") as string;
  host.emit({ type: "change", nodeId: search, value: "milk" });
  await settle();
  host.emit({ type: "key", nodeId: search, value: "Escape" });
  await settle();
  expect(model.getSnapshot().query).toBe("milk");
  expect(model.getSnapshot().selection).toEqual({ start: 11, end: 15 });
  expect(body()?.selection).toEqual({ start: 11, end: 15 });
  expect(body()?.autofocus).toBe(true);
  // ❖G still has the words.
  expect(model.findNext(1)).toBe(true);
  window.unmount();
  model.dispose();
});

test("Esc in Find with nothing found in the note gives the keyboard to the list", async () => {
  store.create({ title: "Groceries", body: "eggs" });
  const model = new NotesModel(store, 60_000);
  model.select("Groceries.md");
  const { host, window, body } = mount(model);
  await settle();
  const search = window.nodeId("search") as string;
  host.emit({ type: "change", nodeId: search, value: "Groceries" });
  await settle();
  host.emit({ type: "key", nodeId: search, value: "Escape" });
  await settle();
  expect(model.getSnapshot().query).toBe("Groceries");
  expect(body()?.autofocus).toBeFalsy();
  window.unmount();
  model.dispose();
});
