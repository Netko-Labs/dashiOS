import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { FOLD_ORDER, foldTools, planToolbar, TITLE_FLOOR, TITLE_MAX, TOOLS, titleWidth, toolbarWidth, toolWidths } from "../apps/preview/lib/fold.ts";
import { Viewer } from "../apps/preview/lib/viewer.ts";
import { PreviewWindow } from "../apps/preview/lib/views/view.tsx";
import { settle } from "./support/time.ts";

// Preview's toolbar in a narrow window: what doesn't fit folds into "…", the least important first, never cut.

const widths = toolWidths({ position: null, zoomLevel: "43%" });

test("a wide toolbar shows every tool; narrower, the least important fold first, and what's left always fits", () => {
  const full = toolbarWidth(TOOLS, widths);
  // ‹ › | − 43% + ⛶ ⊡ | ↺ ↻ | ⓘ …: the buttons, the label, the gaps and three dividers.
  expect(full).toBe(32 * 2 + 10 + 10 + (32 + 10 + 46 + 10 + 32) + 10 + 32 + 10 + 32 + 10 + (7 + 10) + (32 * 2 + 10) + 10 + (7 + 10) + 32 + 10 + (7 + 10) + 32);
  expect(foldTools(null, widths).shown).toEqual([...TOOLS]);
  expect(foldTools(full, widths)).toEqual({ shown: [...TOOLS], folded: [], width: full });
  let previous = [...TOOLS];
  for (let room = full - 1; room >= 0; room -= 7) {
    const fold = foldTools(room, widths);
    // What is shown is whole, and only ever less as the room shrinks, in FOLD_ORDER.
    expect(fold.width <= room || fold.shown.length === 0).toBe(true);
    expect(fold.shown.every((tool) => previous.includes(tool))).toBe(true);
    const gone = TOOLS.filter((tool) => !fold.shown.includes(tool));
    expect(gone).toEqual(fold.folded);
    expect(FOLD_ORDER.slice(0, gone.length).every((tool) => gone.includes(tool))).toBe(true);
    previous = fold.shown;
  }
  expect(foldTools(0, widths)).toMatchObject({ shown: [], folded: [...TOOLS], width: 32 });
  // Actual Size goes first, then Zoom to Fit; moving stays longest.
  expect(foldTools(full - 1, widths).folded).toEqual(["actual"]);
  expect(foldTools(full - 43, widths).folded).toEqual(["fit", "actual"]);
  expect(foldTools(toolbarWidth(["move"], widths), widths).shown).toEqual(["move"]);
});

test("the row: the words give way first, then the name down to a floor, and only then a tool", () => {
  const full = toolbarWidth(TOOLS, widths);
  const name = "Alex Kim - sunset over the Tagus river from Miradouro da Graça.jpg";
  const want = Math.min(titleWidth(name), TITLE_MAX);
  expect(want).toBe(TITLE_MAX);
  const detail = ["1600 × 1200 · 6 of 24", "1600 × 1200"];
  const plan = (room: number, title: string | null = name) => planToolbar(room, { title, widths, detail, busy: false });
  // Room for all: the whole name (up to TITLE_MAX), every tool, the fullest words.
  expect(plan(2000)).toMatchObject({ title: TITLE_MAX, folded: [], detail: detail[0] });
  // A little less: the words go, the name and the tools stay.
  expect(plan(TITLE_MAX + 10 + full + 40)).toMatchObject({ title: TITLE_MAX, folded: [], detail: null });
  // Less again: the name shortens, every tool stays (the default window with a long name: 1000 less the strip and the lights).
  const shorter = plan(TITLE_FLOOR + 10 + full + 30);
  expect(shorter.folded).toEqual([]);
  expect(shorter.title).toBe(TITLE_FLOOR + 30);
  // At its floor the name stops giving way; past it, tools fold, least important first, and the name takes back the rest.
  const folding = plan(TITLE_FLOOR + 10 + full - 1);
  expect(folding.folded).toEqual(["actual"]);
  expect(folding.title + 10 + folding.width).toBeLessThanOrEqual(TITLE_FLOOR + 10 + full - 1);
  expect(folding.title).toBeGreaterThanOrEqual(TITLE_FLOOR);
  // Whatever the room, what is drawn fits it.
  for (let room = 2000; room >= 60; room -= 9) {
    const each = plan(room);
    expect(each.title + 10 + each.width).toBeLessThanOrEqual(Math.max(room, 10 + 32));
  }
  // A short name is never cut to make room it doesn't need; with the compositor's title bar there is none.
  expect(plan(320, "a.png").title).toBe(titleWidth("a.png"));
  expect(plan(400, null)).toMatchObject({ title: 0 });
  // Not measured yet: everything, and no words.
  expect(planToolbar(null, { title: name, widths, detail, busy: false })).toMatchObject({ folded: [], detail: null, title: TITLE_MAX });
});

test("a narrow window (359 pt, no strip) keeps the name whole, the arrows, and “…”", () => {
  const name = "portrait-alfama.png";
  // 359 less the lights' inset (68 + 14) and the toolbar's right padding.
  const fold = planToolbar(359 - 82 - 12, { title: name, widths, detail: ["900 × 1600 · 23 of 24"], busy: false });
  expect(fold.shown).toEqual(["move"]);
  // The name is drawn about 128 pt wide (the before-still); it gets more than that, and the row still fits.
  expect(fold.title).toBeGreaterThan(130);
  expect(fold.title + 10 + fold.width).toBeLessThanOrEqual(359 - 82 - 12);
});

test("a PDF's wide page count is measured, not assumed", () => {
  expect(toolWidths({ position: "3 / 12", zoomLevel: null }).move).toBe(32 * 2 + 10 + 44 + 10);
  expect(toolWidths({ position: "118 / 1240", zoomLevel: null }).move).toBeGreaterThan(32 * 2 + 10 + 44 + 10);
  expect(toolWidths({ position: null, zoomLevel: null }).zoom).toBe(32 * 2 + 10);
});

let dir = "";
let runtime: string | undefined;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-preview-fold-"));
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = dir;
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
  rmSync(dir, { recursive: true, force: true });
});

const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("in a narrow window the turns and Info are in “…”, not cut at the edge", async () => {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const viewer = new Viewer({ cacheDir: join(dir, "cache"), deviceScale: 1, memoryFile: null });
  const root = render(<PreviewWindow viewer={viewer} clipboard={{ canWrite: false, writeText: async () => false, readText: async () => null }} />, transport);
  const emit = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 28 } });
  const path = join(dir, "pixel.png");
  writeFileSync(path, PIXEL);
  await viewer.open(path);
  await settle();
  expect(root.nodeId("rotate-left")).toBeDefined();

  // The row holds the name too: what is left for the tools is 280.
  emit({ type: "resize", nodeId: node("toolbar-room"), bounds: { x: 300, y: 0, width: 280 + titleWidth("pixel.png") + 10, height: 40 } });
  await settle();
  for (const id of ["previous", "next", "zoom-out", "zoom-in"]) expect(root.nodeId(id)).toBeDefined();
  for (const id of ["fit", "actual", "rotate-left", "rotate-right", "info"]) expect(root.nodeId(id)).toBeUndefined();
  emit({ type: "press", nodeId: node("more") });
  await settle();
  for (const label of ["Zoom to Fit", "Actual Size", "Rotate Left", "Rotate Right", "Get Info", "Open With…"])
    expect(root.nodeId(`more-menu:${label}`)).toBeDefined();
  expect(root.nodeId("more-menu:Zoom In")).toBeUndefined();
  root.unmount();
});
