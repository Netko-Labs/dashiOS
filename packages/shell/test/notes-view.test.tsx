import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { type Row, withDraft } from "../apps/notes/list.ts";
import { NotesModel } from "../apps/notes/model.ts";
import { NotesWindow } from "../apps/notes/view.tsx";
import { NotesStore } from "../src/shared/notes/store.ts";
import { settle } from "./support/time.ts";

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

type Field = Props & { focusNextOnSubmit?: boolean; multiline?: boolean; submitOnEnter?: boolean; value?: string };

test("Return in the title hands the keyboard to the body in the host; the list row follows the typed title at once", async () => {
  store.create({ title: "Groceries", body: "eggs" });
  store.create({ title: "Ideas", body: "a boat" });
  const model = new NotesModel(store, 60_000);
  model.select("Groceries.md");
  const { host, window } = mount(model);
  await settle();
  const title = (): Field | null => inputProps(host.trees.at(-1), window.nodeId("title"));
  // The host moves the keyboard as Return goes down, before any key after it is read.
  expect(title()?.focusNextOnSubmit).toBe(true);
  // A long title wraps (review 54, still 07), and Return still submits rather than breaking it.
  expect(title()?.multiline).toBe(true);
  expect(title()?.submitOnEnter).toBe(true);
  const body = window.nodeId("body");
  host.emit({ type: "change", nodeId: window.nodeId("title") as string, value: "Shopping" });
  await settle();
  // Not saved yet (the save waits for a pause), and still the row says it.
  expect(model.getSnapshot().notes.find((note) => note.id === "Groceries.md")?.title).toBe("Groceries");
  const tree = host.trees.at(-1) ?? "";
  expect(tree).toContain('"Shopping"');
  expect(tree).not.toContain('"Groceries"');
  // The body is the same field: nothing typed into it is lost to a new one.
  expect(window.nodeId("body")).toBe(body);
  window.unmount();
  model.dispose();
});

test("only the open note's row takes what is typed; a deleted one never does", () => {
  const row = (id: string, deleted = false): Row => ({ id, title: id, body: "", modified: 0, pinned: false, folder: "", deleted, deletedAt: 0 });
  const rows = [row("a"), row("b"), row("c", true)];
  const draft = { title: "Typed", body: "first line" };
  expect(withDraft(rows, "b", draft).map((each) => each.title)).toEqual(["a", "Typed", "c"]);
  expect(withDraft(rows, "b", draft)[1]?.body).toBe("first line");
  expect(withDraft(rows, "c", draft).map((each) => each.title)).toEqual(["a", "b", "c"]);
  expect(withDraft(rows, null, draft)).toEqual(rows);
  expect(withDraft(rows, "a", null)).toEqual(rows);
});
