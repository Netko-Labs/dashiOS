import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { titleWidth } from "../apps/preview/lib/fold.ts";
import { Viewer } from "../apps/preview/lib/viewer.ts";
import { InfoSheet } from "../apps/preview/lib/views/sheets.tsx";
import { EmptyView, RECENT_FOLDER_WIDTH } from "../apps/preview/lib/views/states.tsx";
import { STRIP } from "../apps/preview/lib/views/strip.tsx";
import { PreviewWindow } from "../apps/preview/lib/views/view.tsx";
import { settle } from "./support/time.ts";

// Preview's chrome as the layout audit found it: the strip gives a narrow window to the picture, the name gives
// way before a tool folds, "…" hangs from its button in groups, an Info row grows with its value, and a recent
// row keeps its folder.

interface Node {
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;
function find(node: Node, id: string | undefined): Node | undefined {
  if (id !== undefined && node.props.id === id) return node;
  return (node.children ?? []).map((child) => (isNode(child) ? find(child, id) : undefined)).find(Boolean);
}

let dir = "";
let runtime: string | undefined;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-preview-chrome-"));
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

function mount(element: (viewer: Viewer) => Parameters<typeof render>[0]) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const trees: string[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const viewer = new Viewer({ cacheDir: join(dir, "cache"), deviceScale: 1, memoryFile: null });
  const root = render(element(viewer), transport);
  const emit = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 28 } });
  return { root, viewer, emit, node, tree: () => JSON.parse(trees.at(-1) ?? "{}") as Node };
}

const window = () =>
  mount((viewer) => <PreviewWindow viewer={viewer} clipboard={{ canWrite: false, writeText: async () => false, readText: async () => null }} />);

async function folderOf(name: string, count: number): Promise<string> {
  const folder = join(dir, name);
  mkdirSync(folder);
  for (let index = 1; index <= count; index++) writeFileSync(join(folder, `pic-${index}.png`), PIXEL);
  return folder;
}

test("a narrow window gives the strip's room to the picture; a wide one gives the strip a share", async () => {
  const folder = await folderOf("narrow", 4);
  const { root, viewer, emit, node } = window();
  await viewer.open(join(folder, "pic-1.png"));
  await settle();
  expect(root.nodeId("window-sidebar")).toBeDefined();
  // 359 pt wide: the picture area is all of it less the strip it had.
  emit({ type: "resize", nodeId: node("drop-area"), bounds: { x: 200, y: 38, width: 159, height: 560 } });
  await settle();
  expect(root.nodeId("window-sidebar")).toBeUndefined();
  // 800 pt: the strip comes back, a fifth of the window.
  emit({ type: "resize", nodeId: node("drop-area"), bounds: { x: 0, y: 38, width: 800, height: 560 } });
  await settle();
  expect(root.nodeId("window-sidebar")).toBeDefined();
  // View ▸ Sidebar still hides it (and shows it again in a narrow window).
  root.unmount();
  expect(STRIP.hideBelow).toBeGreaterThan(359);
});

test("the name gives way before a tool folds, and “…” lists what folded in its own group", async () => {
  const { root, viewer, emit, node, tree } = window();
  const name = "Alex Kim - sunset over the Tagus river from Miradouro da Graça.png";
  writeFileSync(join(dir, name), PIXEL);
  await viewer.open(join(dir, name));
  await settle();
  // The default window with the strip: 1000 less the strip (200), the toolbar's padding (18 + 12).
  emit({ type: "resize", nodeId: node("toolbar-room"), bounds: { x: 218, y: 0, width: 770, height: 38 } });
  await settle();
  for (const id of ["previous", "next", "zoom-out", "zoom-in", "fit", "actual", "rotate-left", "rotate-right", "info", "more"])
    expect(root.nodeId(id)).toBeDefined();
  const title = find(tree(), root.nodeId("title"));
  expect(Number(title?.props.maxWidth)).toBeLessThan(titleWidth(name));
  // Narrower: tools fold; "…" lists them, then a line, then the file's commands.
  emit({ type: "resize", nodeId: node("toolbar-room"), bounds: { x: 218, y: 0, width: 400, height: 38 } });
  await settle();
  expect(root.nodeId("actual")).toBeUndefined();
  emit({ type: "press", nodeId: node("more"), bounds: { x: 900, y: 5, width: 32, height: 28 } });
  await settle();
  expect(root.nodeId("more-menu:Actual Size")).toBeDefined();
  const menu = find(tree(), root.nodeId("more-menu"));
  const text = JSON.stringify(menu);
  expect(text.indexOf("Actual Size")).toBeLessThan(text.indexOf("Open With"));
  // The separators: after the folded tools, before Export, before Trash.
  const rows = JSON.stringify(menu).match(/"height":9/g) ?? [];
  expect(rows.length).toBe(3);
  root.unmount();
});

test("an Info row's value grows the row: it takes a share of the row from a zero basis, never a fixed one", async () => {
  const { root, tree } = mount(() => (
    <InfoSheet
      name="Quarterly report.pdf"
      rows={[["Title", "Kim Studio quarterly report: Lisbon and Porto, third quarter, with appendices"]]}
      onClose={() => {}}
    />
  ));
  await settle();
  const value = find(tree(), root.nodeId("info-sheet:Title"));
  expect(value?.props.flex).toBe(2);
  expect(value?.props.maxWidth).toBeUndefined();
  root.unmount();
});

test("a recent row keeps its folder: the name gives way, the folder never shrinks to nothing", async () => {
  const path = join(dir, "Alex Kim - sunset over the Tagus river from Miradouro da Graça.jpg");
  const { root, tree } = mount(() => <EmptyView recents={[{ path, openedMs: 0 }]} onOpen={() => {}} onRecent={() => {}} />);
  await settle();
  const folder = find(tree(), root.nodeId("recent-folder:Alex Kim - sunset over the Tagus river from Miradouro da Graça.jpg"));
  expect(folder?.props.shrink).toBe(false);
  expect(folder?.props.maxWidth).toBe(RECENT_FOLDER_WIDTH);
  root.unmount();
});
