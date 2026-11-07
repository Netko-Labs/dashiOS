import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { galleryMenus } from "../apps/components/menus.ts";
import { columnsFor, PAGES, stepPage } from "../apps/components/pages.ts";
import { GalleryWindow } from "../apps/components/view.tsx";
import { enabledIds } from "../apps/kit/index.ts";
import { dockDefaults, resolvePinned } from "../src/apps.ts";

// The @dashi/ui gallery on a stand-in for the Metal host: every page draws, in both modes, and the keys and the mode control work.
let dir = "";
let runtime: string | undefined;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-components-"));
  // No menus socket here: the kit's menus client stays quiet.
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = dir;
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
  rmSync(dir, { recursive: true, force: true });
});

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 30));

/** A key the window got, as Metal hands it to a KeySink (`onWindowKeyDown`). */
const windowKey = (nodeId: string, key: string): NativeEvent => ({
  type: "windowkey",
  nodeId,
  key,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  repeat: false,
});

function mount() {
  const listeners: ((event: NativeEvent) => void)[] = [];
  let last = "";
  const transport: NativeTransport = {
    send: (tree) => {
      last = tree;
    },
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const root: NativeRoot = render(<GalleryWindow />, transport);
  const emit = async (event: NativeEvent): Promise<void> => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  return { root, emit, node, tree: () => last };
}

test("pages step in sidebar order and stop at the ends; Both draws a light and a dark column", () => {
  expect(stepPage("buttons", 1)).toBe("pickers");
  expect(stepPage("buttons", -1)).toBe("buttons");
  expect(stepPage("type", 1)).toBe("type");
  expect(columnsFor("both")).toEqual([false, true]);
  expect(columnsFor("dark")).toEqual([true]);
  expect(new Set(PAGES.map((page) => page.id)).size).toBe(PAGES.length);
});

test("the View menu picks the mode and walks the pages", () => {
  const seen: string[] = [];
  const { menus, run } = galleryMenus({ mode: "both", page: "buttons", setMode: (mode) => seen.push(mode), setPage: (page) => seen.push(page) });
  expect(enabledIds(menus).has("page:previous")).toBe(false);
  run("mode:dark");
  run("page:next");
  expect(seen).toEqual(["dark", "pickers"]);
});

test("every page draws its exhibits in Light and Dark side by side", async () => {
  const gallery = mount();
  await settle();
  for (const page of PAGES) {
    await gallery.emit({ type: "press", nodeId: gallery.node(`page:${page.id}`) });
    expect(gallery.root.nodeId(`components:page:${page.id}`)).toBeDefined();
    expect(gallery.root.nodeId("exhibit:light")).toBeDefined();
    expect(gallery.root.nodeId("exhibit:dark")).toBeDefined();
  }
  gallery.root.unmount();
});

test("the mode control draws one column; the arrows walk the pages", async () => {
  const gallery = mount();
  await settle();
  await gallery.emit({ type: "press", nodeId: gallery.node("components:mode:dark") });
  expect(gallery.root.nodeId("exhibit:light")).toBeUndefined();
  expect(gallery.root.nodeId("exhibit:dark")).toBeDefined();
  await gallery.emit(windowKey(gallery.node("components:keys"), "down"));
  expect(gallery.root.nodeId("components:page:pickers")).toBeDefined();
  // A pop-up button in an exhibit opens its menu over the window, and closes it on a pick.
  await gallery.emit({ type: "press", nodeId: gallery.node("popup:enabled"), bounds: { x: 300, y: 200, width: 170, height: 28 } });
  await gallery.emit({ type: "press", nodeId: gallery.node("popup:enabled:menu:US Letter") });
  expect(gallery.root.nodeId("popup:enabled:menu")).toBeUndefined();
  expect(gallery.tree()).toContain("US Letter");
  gallery.root.unmount();
});

test("the gallery is in the launcher but not in a new Dock", () => {
  const components = resolvePinned(() => "/usr/bin/bun").find((app) => app.id === "dev.dashi.components");
  expect(components?.exec?.[1]).toEndWith("apps/components/main.tsx");
  expect(dockDefaults([{ id: "dev.dashi.components" }])).toEqual([]);
});
