import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { type DocumentView, useDocument } from "../apps/preview/lib/document.ts";
import { fitWidthScale, layoutPages, MARGIN } from "../apps/preview/lib/layout.ts";
import { Viewer } from "../apps/preview/lib/viewer.ts";
import { PreviewWindow } from "../apps/preview/lib/views/view.tsx";
import { settle } from "./support/time.ts";

// A PDF in Preview's window on a stand-in for the Metal host, drawn by the real poppler: one scrolling
// surface, pages rendered as they come near the screen, the page strip, the keys, and text selected by a drag.

const hasTools = Bun.which("pdftoppm") !== null && Bun.which("pdfinfo") !== null && Bun.which("magick") !== null;
const TESTPAGE = "/usr/share/cups/data/default-testpage.pdf";

let dir = "";
let runtime: string | undefined;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-preview-document-"));
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = dir;
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
  rmSync(dir, { recursive: true, force: true });
});

async function until(what: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!what()) {
    if (Date.now() > end) throw new Error("timed out");
    await settle(25);
  }
}

function mount() {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const viewer = new Viewer({ cacheDir: join(dir, "cache"), deviceScale: 1, memoryFile: null });
  const copied: string[] = [];
  const root = render(
    <PreviewWindow
      viewer={viewer}
      cacheDir={join(dir, "cache")}
      clipboard={{ canWrite: true, writeText: async (text) => copied.push(text) > 0, readText: async () => null }}
    />,
    transport,
  );
  const emit = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  const text = (testID: string): string => textOf(JSON.parse(root.lastTree() ?? "null"), node(testID));
  emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 28 } });
  return { root, viewer, emit, node, text, copied };
}

/** The words drawn inside a node of the last tree. */
function textOf(tree: unknown, id: string): string {
  let found = "";
  const walk = (value: unknown, inside: boolean): void => {
    if (typeof value === "string") {
      if (inside) found += value;
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const node = value as { props?: { id?: string }; children?: unknown[] };
    const here = inside || node.props?.id === id;
    for (const child of node.children ?? []) walk(child, here);
  };
  walk(tree, false);
  return found;
}

test.skipIf(!hasTools)("a PDF is one surface: it opens to its width, scrolls with the wheel and the keys, and the strip follows", async () => {
  const pdf = join(dir, "three.pdf");
  const made = Bun.spawnSync(["magick", "-size", "300x400", "xc:white", "-size", "400x300", "xc:#eeeeee", "-size", "300x400", "xc:white", pdf]);
  expect(made.exitCode).toBe(0);
  const { root, viewer, emit, node, text } = mount();
  await viewer.open(pdf);
  await settle();
  const area = { x: 200, y: 38, width: 800, height: 600 };
  emit({ type: "resize", nodeId: node("document"), bounds: area });
  emit({ type: "resize", nodeId: node("strip"), bounds: { x: 0, y: 38, width: 200, height: 600 } });
  await until(() => viewer.getSnapshot().pdf?.renders.has(1) === true);
  await settle();
  expect(root.nodeId("page:1")).toBeDefined();
  expect(text("position")).toBe("1 / 3");
  // To the width: the widest page fills it, less its margins.
  const scale = fitWidthScale(viewer.getSnapshot().pdf?.sizes ?? [], area.width);
  expect(text("zoom-level")).toBe(`${Math.round((scale / (96 / 72)) * 100)}%`);
  await until(() => (viewer.getSnapshot().pdf?.thumbs.size ?? 0) === 3);
  expect(root.nodeId("strip:3")).toBeDefined();

  // The wheel scrolls: far enough down, the second page is the one in the middle.
  const layout = layoutPages(viewer.getSnapshot().pdf?.sizes ?? [], scale, area.width);
  const second = layout.boxes[1];
  if (!second) throw new Error("no second page");
  emit({ type: "wheel", nodeId: node("document"), dx: 0, dy: -(second.top + MARGIN) / 24 });
  await settle();
  expect(text("position")).toBe("2 / 3");
  await until(() => viewer.getSnapshot().pdf?.renders.has(2) === true);

  // → goes to the next page, Home to the top.
  emit({ type: "windowkey", nodeId: node("keys"), key: "right", ctrl: false, alt: false, shift: false, meta: false, repeat: false });
  await settle();
  expect(text("position")).toBe("3 / 3");
  emit({ type: "windowkey", nodeId: node("keys"), key: "home", ctrl: false, alt: false, shift: false, meta: false, repeat: false });
  await settle();
  expect(text("position")).toBe("1 / 3");
  // A click in the strip goes to that page.
  emit({ type: "press", nodeId: node("strip:2") });
  await settle();
  expect(text("position")).toBe("2 / 3");

  // Rotated, every page turns and the rotation is kept with the file.
  await viewer.rotate(1);
  await until(() => viewer.getSnapshot().pdf?.renders.has(2) === true);
  expect(viewer.getSnapshot().pdf?.sizes[0]).toEqual({ width: 400, height: 300 });
  root.unmount();
});

test.skipIf(!hasTools || !existsSync(TESTPAGE))("a drag across a page's text selects it, drawn over the words", async () => {
  const pdf = join(dir, "testpage.pdf");
  copyFileSync(TESTPAGE, pdf);
  const { root, viewer, emit, node } = mount();
  await viewer.open(pdf);
  await settle();
  const area = { x: 0, y: 0, width: 800, height: 600 };
  emit({ type: "resize", nodeId: node("document"), bounds: area });
  await until(() => viewer.getSnapshot().pdf?.renders.has(1) === true);
  // "Printer Test Page" sits about 59 to 96 points down, 163 to 430 across.
  const scale = fitWidthScale(viewer.getSnapshot().pdf?.sizes ?? [], area.width);
  const page = layoutPages(viewer.getSnapshot().pdf?.sizes ?? [], scale, area.width).boxes[0];
  if (!page) throw new Error("no page");
  const at = (x: number, y: number) => ({ x: page.left + x * scale, y: page.top + y * scale });
  const from = at(170, 77);
  const to = at(420, 77);
  const document = node("document");
  emit({ type: "pointer", nodeId: document, phase: "down", ...from, bounds: area });
  emit({ type: "pointer", nodeId: document, phase: "move", ...to, bounds: area });
  emit({ type: "pointer", nodeId: document, phase: "up", ...to, bounds: area });
  await until(() => root.nodeId("selection:1:0") !== undefined);
  // A click lets go of it.
  emit({ type: "pointer", nodeId: document, phase: "down", ...from, bounds: area });
  emit({ type: "pointer", nodeId: document, phase: "up", ...from, bounds: area });
  await settle();
  expect(root.nodeId("selection:1:0")).toBeUndefined();
  root.unmount();
});

test.skipIf(!hasTools || !existsSync(TESTPAGE))("❖C straight after ❖A copies the text, before the window has drawn the selection", async () => {
  const pdf = join(dir, "testpage-all.pdf");
  copyFileSync(TESTPAGE, pdf);
  const viewer = new Viewer({ cacheDir: join(dir, "cache"), deviceScale: 1, memoryFile: null });
  await viewer.open(pdf);
  const seen: { doc: DocumentView | null } = { doc: null };
  function Probe() {
    const snap = useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
    seen.doc = useDocument(viewer, snap.pdf, snap.turns, snap.path);
    return null;
  }
  const transport: NativeTransport = { send() {}, onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(<Probe />, transport);
  await until(() => seen.doc?.layout.boxes.length === 1);
  // The menus run the actions of the window as last drawn: Select All, then Copy, with no draw between them.
  const doc = seen.doc as DocumentView;
  expect(doc.hasSelection()).toBe(false);
  doc.selectAll();
  expect(doc.hasSelection()).toBe(true);
  expect(await doc.copyText()).toContain("Printer Test Page");
  root.unmount();
});
