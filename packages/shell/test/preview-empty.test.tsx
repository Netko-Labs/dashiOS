import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { enabledIds } from "../apps/kit/index.ts";
import { droppedFile } from "../apps/preview/drop.ts";
import { previewMenus } from "../apps/preview/menus.ts";
import { PreviewWindow } from "../apps/preview/view.tsx";
import { Viewer } from "../apps/preview/viewer.ts";

// Preview's empty window on a stand-in for the Metal host: what it offers, and a file dropped on it.
let dir = "";
let runtime: string | undefined;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-preview-empty-"));
  // No menus socket here: the kit's menus client stays quiet.
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = dir;
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
  rmSync(dir, { recursive: true, force: true });
});

/** A 1 × 1 PNG. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 40));

function mount() {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const viewer = new Viewer({ cacheDir: join(dir, "cache"), deviceScale: 1 });
  const root = render(<PreviewWindow viewer={viewer} clipboard={{ canWrite: false, writeText: async () => false, readText: async () => null }} />, transport);
  const emit = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 28 } });
  return { root, viewer, emit };
}

test("the dropped file Preview opens: the first it can show by name, else the first", () => {
  expect(droppedFile(["/home/alexk/notes.txt", "/home/alexk/photo.jpg", "/home/alexk/scan.pdf"])).toBe("/home/alexk/photo.jpg");
  expect(droppedFile(["/home/alexk/notes.txt"])).toBe("/home/alexk/notes.txt");
  expect(droppedFile([])).toBeNull();
});

test("with no file, Open With… and Show in Files can't be chosen; Open… can", () => {
  const actions = new Proxy({}, { get: () => () => {} }) as Parameters<typeof previewMenus>[0]["actions"];
  const { menus } = previewMenus({
    hasFile: false,
    hasPicture: false,
    isPdf: false,
    canTurn: false,
    canSaveCopy: false,
    canPrevious: false,
    canNext: false,
    canCopy: true,
    thumbnails: true,
    blocked: false,
    actions,
  });
  const enabled = enabledIds(menus);
  expect(enabled.has("open")).toBeTrue();
  for (const id of ["open-with", "show-in-files", "info", "trash", "copy-path", "zoom-in", "rotate-left", "next"]) expect(enabled.has(id)).toBeFalse();
});

test("the empty window has no dead toolbar controls, an Open… button, and opens a dropped file", async () => {
  const { root, viewer, emit } = mount();
  await settle();
  expect(root.nodeId("open")).toBeDefined();
  for (const id of ["previous", "next", "zoom-out", "zoom-level", "zoom-in", "fit", "actual", "rotate-left", "rotate-right", "info", "more"]) {
    expect(root.nodeId(id)).toBeUndefined();
  }

  const path = join(dir, "pixel.png");
  writeFileSync(path, PIXEL);
  const area = root.nodeId("drop-area");
  if (!area) throw new Error("no drop area");
  emit({ type: "drop", nodeId: area, phase: "enter", x: 100, y: 100, paths: [path], ctrl: false, alt: false, shift: false });
  await settle();
  expect(root.nodeId("drop-target")).toBeDefined();
  emit({ type: "drop", nodeId: area, phase: "drop", x: 100, y: 100, paths: [path], ctrl: false, alt: false, shift: false });
  await settle();
  expect(root.nodeId("drop-target")).toBeUndefined();
  expect(viewer.getSnapshot().path).toBe(path);
  // A file is open: the toolbar is back, and the zoom shows.
  expect(root.nodeId("zoom-in")).toBeDefined();
  expect(root.nodeId("more")).toBeDefined();
  root.unmount();
});
