import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { fitFontSize, textEms } from "../apps/calculator/format.ts";
import { MIN_SIZE, PAD, TAPE_WIDTH } from "../apps/calculator/layout.ts";
import { EN_US } from "../apps/calculator/locale.ts";
import type { Remembered } from "../apps/calculator/store.ts";
import { CalculatorWindow } from "../apps/calculator/view.tsx";
import { resultWords } from "../apps/calculator/words.ts";
import type { Clipboard, Size } from "../apps/kit/index.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

fakeClockEachTest();

// The window mounted on a stand-in for the Metal host: what it sends, and events sent back as the host would.
let dir = "";
let runtime: string | undefined;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-calculator-view-"));
  // No menus socket here: the kit's menus client stays quiet.
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = dir;
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
  rmSync(dir, { recursive: true, force: true });
});

interface TreeNode {
  type?: string;
  props?: Record<string, unknown> & { access?: { label?: string } };
  children?: TreeNode[];
}

function findView(node: TreeNode, matches: (node: TreeNode) => boolean): TreeNode | null {
  if (matches(node)) return node;
  for (const child of node.children ?? []) {
    const found = findView(child, matches);
    if (found) return found;
  }
  return null;
}

async function mount(remembered: Remembered, pasted = "Total: 1,234.50") {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const copied: string[] = [];
  const clipboard: Clipboard = {
    canWrite: true,
    writeText: async (text) => {
      copied.push(text);
      return true;
    },
    readText: async () => pasted,
  };
  const kept: Remembered[] = [];
  const sizes: Size[] = [];
  const root = render(
    <CalculatorWindow
      clipboard={clipboard}
      locale={EN_US}
      remembered={remembered}
      remember={(next) => kept.push(next)}
      resizeWindow={(size) => sizes.push(size)}
    />,
    transport,
  );
  const emit = async (event: NativeEvent, wait?: number): Promise<void> => {
    for (const listener of listeners) listener(event);
    await settle(wait);
  };
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  await settle();
  const tree = (): string => trees.at(-1) ?? "";
  return { root, emit, node, tree, copied, kept, sizes, press: (testID: string) => emit({ type: "press", nodeId: node(testID) }) };
}

test("typing, the keypad and Return edit one line, with the result under it", async () => {
  const calc = await mount({ tape: [], showsTape: false, size: null });
  await calc.emit({ type: "change", nodeId: calc.node("line"), value: "1250*12" });
  expect(calc.tree()).toContain('"value":"1,250 × 12"');
  await calc.press("key:plus");
  await calc.press("key:3");
  await calc.press("key:4");
  await calc.press("key:0");
  expect(calc.tree()).toContain('"value":"1,250 × 12 + 340"');
  expect(calc.tree()).toContain("= 15,340");
  await calc.emit({ type: "submit", nodeId: calc.node("line"), value: "1,250 × 12 + 340" }, 450);
  expect(calc.tree()).toContain('"value":"15,340"');
  // The tape is remembered once the window settles.
  expect(calc.kept.at(-1)?.tape).toEqual([{ expression: "1250 × 12 + 340", value: 15340 }]);
  calc.root.unmount();
});

test("the tape shows beside the keypad; a click on a row puts its result in the line", async () => {
  const calc = await mount({ tape: [{ expression: "2 + 3", value: 5 }], showsTape: true, size: { width: 274 + TAPE_WIDTH, height: 440 } });
  expect(calc.tree()).toContain("Tape");
  expect(calc.tree()).toContain("= 5");
  // A row's lines take its width, right-aligned in it: never squeezed to nothing ("…").
  const row = findView(JSON.parse(calc.tree()), (node) => node.props?.access?.label === "2 + 3 = 5");
  expect(row?.props?.align).toBe("stretch");
  const lines = (row?.children ?? []).map((line) => line.props ?? {});
  expect(lines.map((line) => line.align ?? line.textAlign)).toEqual(["right", "right"]);
  // Neither line is clamped: the clamped result drew only "…" in the host (review 21).
  expect(lines.map((line) => line.truncate)).toEqual([undefined, undefined]);
  await calc.press("key:1");
  await calc.press("key:plus");
  await calc.emit({ type: "press", nodeId: calc.node("tape-clear") });
  expect(calc.tree()).toContain("Your sums show up here.");
  calc.root.unmount();
});

test("the window's size comes from its layout: square keys, centred, and one right edge for the line (review 16, 22)", async () => {
  const calc = await mount({ tape: [], showsTape: true, size: null });
  // Tiled to fill the screen after it opened at 498 × 440: the root hears it.
  await calc.emit({ type: "resize", nodeId: calc.node("calculator"), bounds: { x: 0, y: 0, width: 1097, height: 658 } });
  const tree = JSON.parse(calc.tree());
  const keypad = findView(tree, (node) => node.props?.id === calc.node("keypad"));
  expect(keypad?.props?.gridTemplateColumns ?? keypad?.props?.gridColumns).toBeDefined();
  const tracks = JSON.stringify(keypad?.props);
  expect(tracks).toContain("97");
  expect(tracks).not.toContain("fr");
  // The line takes the display's width with its text at the right edge, where the result and the keys end.
  const line = findView(tree, (node) => node.props?.id === calc.node("line"));
  expect(line?.props?.align).toBe("right");
  expect(line?.props?.widthPercent).toBe(1);
  // = is ink, not kombu: kombu means on.
  const equals = findView(tree, (node) => node.props?.id === calc.node("key:equals"));
  expect(equals?.props?.background).toBe("#1d1d1f");
  // And the size it remembers is the window's.
  await settle(450);
  expect(calc.kept.at(-1)?.size).toEqual({ width: 1097, height: 658 });
  calc.root.unmount();
});

test("a paste in the line reads one number; a refused one never lands; Esc clears it", async () => {
  const calc = await mount({ tape: [], showsTape: false, size: null });
  await calc.emit({ type: "change", nodeId: calc.node("line"), value: "Total: 1,234.50" });
  expect(calc.tree()).toContain('"value":"1,234.5"');
  // Text the field put in itself and the line refuses: the field takes the line back (a new revision).
  await calc.emit({ type: "change", nodeId: calc.node("line"), value: "1,234.5calc" });
  expect(calc.tree()).toContain("Not a number or a sum");
  expect(calc.tree()).toContain('"value":"1,234.5"');
  expect(calc.tree()).toContain('"revision":1');
  await calc.emit({ type: "key", nodeId: calc.node("line"), value: "Escape" });
  expect(calc.tree()).toContain('"value":""');
  calc.root.unmount();
});

test("Paste from the menu is read the line's way; refused, the line stays and the note fits", async () => {
  const calc = await mount({ tape: [], showsTape: false, size: null }, "calc 3x4");
  await calc.press("key:1");
  await calc.emit({ type: "contextmenu", nodeId: calc.node("display"), x: 100, y: 40 });
  await calc.press("calculator-menu:Paste");
  expect(calc.tree()).toContain('"value":"1"');
  expect(calc.tree()).toContain("Not a number or a sum");
  // The note is as large as fits the display on its one row.
  const words = resultWords({ kind: "notice", notice: "refused-paste" }).text;
  expect(fitFontSize(words, MIN_SIZE.width - PAD * 2, 17, 11) * textEms(words)).toBeLessThanOrEqual(MIN_SIZE.width - PAD * 2);
  calc.root.unmount();
});
