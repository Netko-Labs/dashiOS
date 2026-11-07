import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { type CommandHooks, copy } from "../apps/preview/commands.ts";
import { PreviewWindow } from "../apps/preview/view.tsx";
import { pngSize, Viewer } from "../apps/preview/viewer.ts";

// Pictures in Preview: the folder's filmstrip, a rotation that sticks, the recent files, and Copy.

const hasMagick = Bun.which("magick") !== null;
/** A 1 × 1 PNG. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

let dir = "";
let runtime: string | undefined;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-preview-pictures-"));
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = dir;
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
  rmSync(dir, { recursive: true, force: true });
});

const settle = (ms = 40): Promise<void> => new Promise((done) => setTimeout(done, ms));
async function until(what: () => boolean, ms = 4_000): Promise<void> {
  const end = Date.now() + ms;
  while (!what()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await settle(20);
  }
}

function mount(memoryFile: string | null) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const viewer = new Viewer({ cacheDir: join(dir, "cache"), deviceScale: 1, memoryFile });
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
  return { root, viewer, emit, node };
}

test("a folder of pictures is a filmstrip in the sidebar; a click opens one, the arrows step", async () => {
  const folder = join(dir, "trip");
  mkdirSync(folder);
  for (const name of ["img10.png", "img2.png", "img1.png"]) writeFileSync(join(folder, name), PIXEL);
  const { root, viewer, emit, node } = mount(null);
  await viewer.open(join(folder, "img1.png"));
  await until(() => viewer.getSnapshot().folder.count === 3);
  expect(viewer.getSnapshot().folder.files).toEqual(["img1.png", "img2.png", "img10.png"]);
  await settle();
  emit({ type: "resize", nodeId: node("strip"), bounds: { x: 0, y: 38, width: 200, height: 500 } });
  await until(() => viewer.getSnapshot().folderThumbs.size === 3);
  emit({ type: "press", nodeId: node("strip:3") });
  await until(() => viewer.getSnapshot().name === "img10.png");
  emit({ type: "windowkey", nodeId: node("keys"), key: "left", ctrl: false, alt: false, shift: false, meta: false, repeat: false });
  await until(() => viewer.getSnapshot().name === "img2.png");
  root.unmount();
});

test.skipIf(!hasMagick)("a rotation sticks: the file opens rotated next time", async () => {
  const memory = join(dir, "state", "memory.json");
  const path = join(dir, "turn.png");
  writeFileSync(path, PIXEL);
  const first = new Viewer({ cacheDir: join(dir, "cache"), deviceScale: 1, memoryFile: memory });
  await first.open(path);
  await first.rotate(1);
  expect(first.getSnapshot().turns).toBe(1);
  const again = new Viewer({ cacheDir: join(dir, "cache"), deviceScale: 1, memoryFile: memory });
  await again.open(path);
  expect(again.getSnapshot().turns).toBe(1);
  expect(again.getSnapshot().phase).toBe("ready");
});

test.skipIf(!hasMagick)("a turned picture's filmstrip thumbnail turns with it", async () => {
  const folder = join(dir, "turned");
  mkdirSync(folder);
  for (const name of ["wide1.png", "wide2.png"]) {
    expect(Bun.spawnSync(["magick", "-size", "40x20", "xc:#336699", join(folder, name)]).exitCode).toBe(0);
  }
  const { root, viewer, emit, node } = mount(join(dir, "turned-state", "memory.json"));
  await viewer.open(join(folder, "wide1.png"));
  await until(() => viewer.getSnapshot().folder.count === 2);
  await settle();
  emit({ type: "resize", nodeId: node("strip"), bounds: { x: 0, y: 38, width: 200, height: 500 } });
  await until(() => viewer.getSnapshot().folderThumbs.size === 2);
  const before = viewer.getSnapshot().folderThumbs.get("wide1.png") ?? "";
  expect(await pngSize(before)).toEqual({ width: 40, height: 20 });
  await viewer.rotate(1);
  await until(() => (viewer.getSnapshot().folderThumbs.get("wide1.png") ?? before) !== before);
  expect(await pngSize(viewer.getSnapshot().folderThumbs.get("wide1.png") ?? "")).toEqual({ width: 20, height: 40 });
  // The other picture keeps its own.
  expect(await pngSize(viewer.getSnapshot().folderThumbs.get("wide2.png") ?? "")).toEqual({ width: 40, height: 20 });
  root.unmount();
});

test("the empty window lists the recent files, and opens one", async () => {
  const memory = join(dir, "recents", "memory.json");
  const path = join(dir, "recent.png");
  writeFileSync(path, PIXEL);
  const seed = new Viewer({ cacheDir: join(dir, "cache"), deviceScale: 1, memoryFile: memory });
  await seed.open(path);
  const { root, viewer, emit, node } = mount(memory);
  await settle();
  expect(root.nodeId("recents")).toBeDefined();
  emit({ type: "press", nodeId: node("recent:recent.png") });
  await until(() => viewer.getSnapshot().path === path);
  root.unmount();
});

test("Copy puts the selected text on the clipboard, else the picture", async () => {
  const path = join(dir, "copy.png");
  writeFileSync(path, PIXEL);
  const viewer = new Viewer({ cacheDir: join(dir, "cache"), deviceScale: 1, memoryFile: null });
  await viewer.open(path);
  const wrote: string[] = [];
  const hooks: CommandHooks = {
    viewer,
    root: join(dir, "cache"),
    say: (title) => wrote.push(`said ${title}`),
    working: () => {},
    board: {
      canWrite: true,
      writeText: async (text) => wrote.push(`text ${text}`) > 0,
      readText: async () => null,
      writeFile: async (file, mime) => wrote.push(`file ${file} ${mime}`) > 0,
    },
  };
  await copy(hooks, viewer.getSnapshot(), async () => "Dear Alex,", 1);
  await copy(hooks, viewer.getSnapshot(), null, 1);
  expect(wrote).toEqual(["text Dear Alex,", `file ${path} image/png`]);
});
