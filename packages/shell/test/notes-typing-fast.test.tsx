/**
 * Notes typed as fast as keys come (review 32: a new table typed at 50 ms a
 * key was saved as `| --- | ------ -- |`): the page on a stand-in for the
 * Metal host whose field types each key into the text and caret the app last
 * sent, with no pause between keys, so the caret never stays put long enough
 * to settle (`SETTLE_MS`). What is saved is exactly what was typed.
 */

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { NotesModel } from "../apps/notes/lib/model.ts";
import { NotesWindow } from "../apps/notes/lib/views/view.tsx";
import { NotesStore } from "../src/shared/notes/store.ts";
import { fakeClockEachTest, flush } from "./support/time.ts";

const clock = fakeClockEachTest();

let runtime: string | undefined;
let scratch = "";
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "dashi-notes-fast-run-"));
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
  root = mkdtempSync(join(tmpdir(), "dashi-notes-fast-"));
  store = new NotesStore(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

interface Field {
  id?: string;
  value?: string;
  selection?: { start: number; end: number };
}
interface Node {
  type: string;
  props: Field;
  children?: unknown[];
}

/** The props of input `id` in a tree. */
function field(tree: string | undefined, id: string | undefined): Field | null {
  const find = (node: Node): Field | null => {
    if (node.type === "input" && node.props.id === id) return node.props;
    for (const child of node.children ?? []) {
      const found = typeof child === "object" && child !== null ? find(child as Node) : null;
      if (found) return found;
    }
    return null;
  };
  return find(JSON.parse(tree ?? "{}") as Node);
}

/** The window, and a field that types keys into what the app last gave it, one after another with no time between. */
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
  const body = (): Field | null => field(trees.at(-1), window.nodeId("body"));
  const nodeId = (): string => window.nodeId("body") ?? "";
  /** A caret put at `at` in the shown text, as a click does. */
  const caret = async (at: number): Promise<void> => {
    emit({ type: "selection", nodeId: nodeId(), start: at, end: at });
    await flush();
  };
  /** Each key typed at the field's caret in its text, the app's answer drawn before the next (0 ms a key); `shows` checks the field after each. */
  const type = async (keys: string, shows?: (text: string) => void): Promise<void> => {
    for (const key of keys) {
      const shown = body();
      const text = shown?.value ?? "";
      const at = shown?.selection?.end ?? text.length;
      emit({ type: "change", nodeId: nodeId(), value: text.slice(0, at) + key + text.slice(at) });
      emit({ type: "selection", nodeId: nodeId(), start: at + 1, end: at + 1 });
      await flush();
      shows?.(body()?.value ?? "");
    }
  };
  return { window, body, caret, type };
}

test("a new table typed at 0 ms a key is kept exactly as typed, and drawn once the caret leaves it", async () => {
  store.create({ title: "Packing", body: "Things to take" });
  const model = new NotesModel(store, 60_000);
  model.select("Packing.md");
  const page = mount(model);
  await flush();
  await page.caret("Things to take".length);
  await clock.advance(200);
  const typed = "\n| E | F |\n| --- | --- |\n| 1 | 2 |";
  // Under the keys the field holds the source as typed: the table forms around the caret and never hides a row it types in.
  await page.type(typed, (text) => {
    expect(text).toBe(model.getSnapshot().draft?.body ?? "");
  });
  expect(model.getSnapshot().draft?.body).toBe(`Things to take${typed}`);
  // The caret stays put: its block (the whole table) shows its source, as typed.
  await clock.advance(200);
  expect(page.body()?.value).toBe(`Things to take${typed}`);
  model.flush();
  expect(store.read("Packing.md")?.body).toBe(`Things to take${typed}`);
  page.window.unmount();
  model.dispose();
});

test("text typed at 0 ms a key into lines that become a heading, a rule and a quote is kept as typed", async () => {
  store.create({ title: "Plan", body: "" });
  const model = new NotesModel(store, 60_000);
  model.select("Plan.md");
  const page = mount(model);
  await flush();
  await page.caret(0);
  await clock.advance(200);
  const typed = "## Trip\nTake **two** bags\n---\n> Leave early";
  await page.type(typed, (text) => expect(text).toBe(model.getSnapshot().draft?.body ?? ""));
  expect(model.getSnapshot().draft?.body).toBe(typed);
  // Once the caret stays put, the lines it left are drawn: the heading without its marker, the rule as a line.
  await clock.advance(200);
  expect(page.body()?.value?.startsWith("Trip\n")).toBe(true);
  expect(page.body()?.value).toContain("> Leave early");
  page.window.unmount();
  model.dispose();
});
