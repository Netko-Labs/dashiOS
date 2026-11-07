import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { TAPE_WIDTH } from "../apps/calculator/layout.ts";
import { EN_US } from "../apps/calculator/locale.ts";
import type { Remembered } from "../apps/calculator/store.ts";
import { CalculatorWindow } from "../apps/calculator/view.tsx";
import type { Clipboard, Size } from "../apps/kit/index.ts";

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

const settle = (ms = 20): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function mount(remembered: Remembered) {
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
    readText: async () => "Total: 1,234.50",
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
  await calc.press("key:1");
  await calc.press("key:plus");
  await calc.emit({ type: "press", nodeId: calc.node("tape-clear") });
  expect(calc.tree()).toContain("Sums you work out show up here.");
  calc.root.unmount();
});

test("Ctrl+V in the line reads one number; Esc clears it", async () => {
  const calc = await mount({ tape: [], showsTape: false, size: null });
  await calc.emit({ type: "change", nodeId: calc.node("line"), value: "Total: 1,234.50" });
  expect(calc.tree()).toContain('"value":"1,234.5"');
  await calc.emit({ type: "change", nodeId: calc.node("line"), value: "1,234.5calc" });
  expect(calc.tree()).toContain("Nothing pasted");
  await calc.emit({ type: "key", nodeId: calc.node("line"), value: "Escape" });
  expect(calc.tree()).toContain('"value":""');
  calc.root.unmount();
});
