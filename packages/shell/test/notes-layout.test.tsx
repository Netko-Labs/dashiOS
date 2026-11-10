import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { fitLine, LIST_NARROW, LIST_WIDTH, NOTES_MIN_SIZE, notesLayout, noticeWidth, RAIL_WIDTH } from "../apps/notes/lib/layout.ts";
import { NotesModel } from "../apps/notes/lib/model.ts";
import { NotesWindow } from "../apps/notes/lib/views/view.tsx";
import { NotesStore } from "../src/shared/notes/store.ts";
import { settle } from "./support/time.ts";

// Review 54 (Notes): a small window left the note 45 pt wide, the Move menu opened far from its
// button, the error covered the list, and a new source kept the old one's scroll.

test("the furniture gives way before the note: a rail below 800, a narrower list and glyph-only buttons below 640", () => {
  expect(notesLayout(0)).toEqual({ rail: false, listWidth: LIST_WIDTH, compact: false });
  expect(notesLayout(980)).toEqual({ rail: false, listWidth: LIST_WIDTH, compact: false });
  expect(notesLayout(700)).toEqual({ rail: true, listWidth: LIST_WIDTH, compact: false });
  expect(notesLayout(539)).toEqual({ rail: true, listWidth: LIST_NARROW, compact: true });
  // At the least size the note still has a column to write in.
  const least = notesLayout(NOTES_MIN_SIZE.width);
  expect(NOTES_MIN_SIZE.width - RAIL_WIDTH - least.listWidth).toBeGreaterThanOrEqual(240);
});

test("a notice at the note's foot is never wider than the note's column", () => {
  expect(noticeWidth(0)).toBe(560);
  expect(noticeWidth(1400)).toBe(560);
  // 980: 980 - 200 - 276 = 504 of column, less 8 a side.
  expect(noticeWidth(980)).toBe(488);
  // 700: the rail; 700 - 56 - 276 = 368.
  expect(noticeWidth(700)).toBe(352);
  // The least size: the notice's own least width.
  expect(noticeWidth(520)).toBe(240);
});

test("the line over a note takes the longest form that fits on one line", () => {
  const [long, medium, short] = ["Edited November 9, 2026 at 1:24 AM · 53 words", "Edited Nov 9, 2026, 1:24 AM · 53 words", "Edited Nov 9 · 53 words"] as const;
  const forms = [long, medium, short];
  expect(fitLine(Number.POSITIVE_INFINITY, forms)).toBe(long);
  expect(fitLine(300, forms)).toBe(long);
  expect(fitLine(260, forms)).toBe(medium);
  expect(fitLine(180, forms)).toBe(short);
  // None fits: the shortest, cut with an ellipsis where it is drawn.
  expect(fitLine(40, forms)).toBe(short);
});

let runtime: string | undefined;
let scratch = "";
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "dashi-notes-layout-run-"));
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
  root = mkdtempSync(join(tmpdir(), "dashi-notes-layout-"));
  store = new NotesStore(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

type Node = { type: string; props: Record<string, unknown>; children?: unknown[] };
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;
function find(node: Node, test: (node: Node) => boolean): Node | undefined {
  if (test(node)) return node;
  return (node.children ?? []).map((child) => (isNode(child) ? find(child, test) : undefined)).find(Boolean);
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
  const emit = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const window = render(<NotesWindow model={model} host={{ scroll: () => {}, press: () => {}, openLink: () => {} }} />, transport);
  emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 28 } });
  const tree = (): Node => JSON.parse(trees.at(-1) ?? "{}") as Node;
  const node = (testID: string): Node | undefined => {
    const id = window.nodeId(testID);
    return id === undefined ? undefined : find(tree(), (each) => each.props.id === id);
  };
  const id = (testID: string): string => window.nodeId(testID) ?? "";
  return { window, emit, tree, node, id };
}

test("a narrow window folds the folders to a rail and narrows the list", async () => {
  store.create({ title: "Groceries", body: "eggs" });
  const model = new NotesModel(store, 60_000);
  const notes = mount(model);
  await settle();
  expect(notes.node("window-sidebar")?.props.width).toBe(200);
  expect(notes.node("note-list")?.props.width).toBe(LIST_WIDTH);
  notes.emit({ type: "resize", nodeId: notes.id("notes-window"), bounds: { x: 0, y: 0, width: 520, height: 400 } });
  await settle();
  expect(notes.node("window-sidebar")?.props.width).toBe(RAIL_WIDTH);
  expect(notes.node("note-list")?.props.width).toBe(LIST_NARROW);
  notes.window.unmount();
  model.dispose();
});

test("the Move menu hangs by its right edge under its button, capped, and never opens lit on the note's own folder", async () => {
  store.createFolder("Recipes and other things from the farmers market on Saturdays");
  store.create({ title: "Groceries", body: "eggs" });
  const model = new NotesModel(store, 60_000);
  model.select("Groceries.md");
  const notes = mount(model);
  await settle();
  notes.emit({ type: "press", nodeId: notes.id("move"), bounds: { x: 700, y: 5, width: 32, height: 28 } });
  await settle();
  const card = notes.node("menu");
  expect(card?.props.maxWidth).toBe(280);
  // Not yet measured: hung from the button's right edge at its least width.
  const box = find(notes.tree(), (each) => each.props.focusTrap === true && each.props.left !== undefined);
  expect(box?.props.left).toBe(732 - 160);
  const here = notes.node("menu:Move to Notes");
  expect(here?.props.focusable).not.toBe(true);
  expect(here?.props.background).toBe("#00000000");
  notes.window.unmount();
  model.dispose();
});

test("an error floats at the foot of the note, clear of the list, and is dismissed by hand", async () => {
  store.create({ title: "Groceries", body: "eggs" });
  const model = new NotesModel(store, 60_000);
  model.select("Groceries.md");
  const notes = mount(model);
  await settle();
  (model as unknown as { set(patch: { error: string }): void }).set({ error: "Notes couldn't make a new note." });
  await settle();
  const wrap = notes.node("note-notice");
  expect(wrap).toBeDefined();
  expect(notes.node("window-notice")).toBeUndefined();
  notes.emit({ type: "press", nodeId: notes.id("error:close") });
  await settle();
  expect(model.getSnapshot().error).toBeNull();
  expect(notes.node("note-notice")).toBeUndefined();
  notes.window.unmount();
  model.dispose();
});

test("a new source starts its list at the top", async () => {
  store.createFolder("Work");
  store.create({ title: "Groceries", body: "eggs" });
  const model = new NotesModel(store, 60_000);
  const notes = mount(model);
  await settle();
  const before = notes.id("note-list");
  model.setSource({ kind: "folder", name: "Work" });
  await settle();
  // A list of its own, not the old one scrolled where it was.
  expect(notes.id("note-list")).not.toBe(before);
  notes.window.unmount();
  model.dispose();
});

test("a name sheet is the alert frame, with its glyph tile, as the confirmations are", async () => {
  store.create({ title: "Groceries", body: "eggs" });
  const model = new NotesModel(store, 60_000);
  const notes = mount(model);
  await settle();
  notes.emit({ type: "press", nodeId: notes.id("new-folder") });
  await settle();
  const sheet = notes.node("name-sheet");
  expect(sheet).toBeDefined();
  // The alert frame's tile: 40 × 40, as on Delete Folder's sheet.
  const tile = sheet && find(sheet, (each) => each.props.width === 40 && each.props.height === 40);
  expect(tile).toBeDefined();
  expect(notes.node("name-field")).toBeDefined();
  notes.window.unmount();
  model.dispose();
});
