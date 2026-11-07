import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { enabledIds } from "../apps/kit/index.ts";
import { droppedFile } from "../apps/preview/drop.ts";
import { otherMime } from "../apps/preview/kinds.ts";
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
  const viewer = new Viewer({ cacheDir: join(dir, "cache"), deviceScale: 1, memoryFile: null });
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
    canPrevious: false,
    canNext: false,
    canCopy: true,
    hasSelection: false,
    canExport: false,
    canPrint: false,
    sidebar: true,
    recents: [],
    blocked: false,
    actions,
  });
  const enabled = enabledIds(menus);
  expect(enabled.has("open")).toBeTrue();
  for (const id of ["open-with", "show-in-files", "export", "print", "info", "trash", "copy", "copy-path", "zoom-in", "rotate-left", "next"])
    expect(enabled.has(id)).toBeFalse();
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

test("a file that isn't what its name says: Open With… for what it is, and no tools with nothing to act on", async () => {
  const { root, viewer } = mount();
  const path = join(dir, "notes.jpg");
  writeFileSync(path, "Shopping: rice, kombu, katsuobushi.\n");
  await viewer.open(path);
  await settle();
  expect(viewer.getSnapshot().phase).toBe("error");
  expect(viewer.getSnapshot().mime).toBe("text/plain");
  expect(root.nodeId("error:open-with")).toBeDefined();
  for (const id of ["previous", "next", "zoom-out", "zoom-in", "fit", "actual", "rotate-left", "rotate-right", "info"]) {
    expect(root.nodeId(id)).toBeUndefined();
  }
  // "…" stays: Open With, Show in Files and Move to Trash still mean something.
  expect(root.nodeId("more")).toBeDefined();
  root.unmount();
});

test("what a file Preview can't show is, for Open With", () => {
  expect(otherMime(new TextEncoder().encode("plain words\n"), "/a/notes.jpg")).toBe("text/plain");
  // A UTF-8 character cut by the end of the head is still text.
  expect(otherMime(new TextEncoder().encode("ruled ☐").subarray(0, 8), "/a/x.png")).toBe("text/plain");
  // Binary under a picture's name: the name lies, so nothing is known.
  expect(otherMime(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), "/a/photo.png")).toBeNull();
  // Binary under a name Preview doesn't claim: the name's type.
  expect(otherMime(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), "/a/report.zip")).toBe("application/zip");
  expect(otherMime(new Uint8Array([0, 1, 2]), "/a/blob")).toBeNull();
});
