import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeTransport, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { TodayButton } from "../apps/calendar/view.tsx";
import { AppearancePreviews } from "../src/settings-app/panes/appearance.tsx";
import { WallpaperPane } from "../src/settings-app/panes/wallpaper.tsx";
import { SettingsStore } from "../src/settings-app/store.ts";
import { FlagsStore } from "../src/shared/control-center/flags.ts";

// The controls the VM review found Tab skipping (KB-1): Appearance's Light,
// Dark and Auto, Wallpaper's tiles, Calendar's Today.

const dir = mkdtempSync(join(tmpdir(), "dashi-focus-stops-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;

function find(node: Node, id: string): Node | undefined {
  if (node.props.id === id) return node;
  return (node.children ?? []).map((child) => (isNode(child) ? find(child, id) : undefined)).find(Boolean);
}

/** Every focusable view under `node`, with the nearest focus group above it (null: a stop of its own). */
function stops(node: Node, group: string | null = null, out: { id: string; group: string | null; selected: unknown }[] = []) {
  const inner = node.props.focusGroup === true ? String(node.props.id) : group;
  if (node.props.focusable === true)
    out.push({ id: String(node.props.id), group, selected: (node.props.access as { selected?: unknown } | undefined)?.selected });
  for (const child of node.children ?? []) if (isNode(child)) stops(child, inner, out);
  return out;
}

async function mount(element: ReactElement) {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(element, transport);
  await new Promise((done) => setTimeout(done, 20));
  return { root, tree: (): Node => JSON.parse(trees.at(-1) ?? "{}") as Node, id: (testID: string) => root.nodeId(testID) ?? "" };
}

const settingsStore = () => new SettingsStore(join(dir, `settings-${Math.random()}.json`));

test("Appearance's Light, Dark and Auto are one Tab stop, entered at the chosen one", async () => {
  const view = await mount(<AppearancePreviews flags={new FlagsStore(null)} settings={settingsStore()} />);
  const group = view.id("appearance-mode");
  const all = stops(view.tree());
  expect(all.map((stop) => stop.id)).toEqual(["appearance-light", "appearance-dark", "appearance-auto"].map(view.id));
  expect(all.every((stop) => stop.group === group)).toBe(true);
  expect(find(view.tree(), group)?.props.focusGroup).toBe(true);
  // Light is chosen while Dark Mode is off: Tab lands there.
  expect(all.filter((stop) => stop.selected === true).map((stop) => stop.id)).toEqual([view.id("appearance-light")]);
  view.root.unmount();
});

test("Wallpaper's tiles are one Tab stop per grid, entered at the chosen picture", async () => {
  const view = await mount(<WallpaperPane settings={settingsStore()} chooser={{ choose: async () => null }} />);
  const grouped = stops(view.tree()).filter((stop) => stop.group !== null);
  // The first grid is the pictures; the live ones are a grid (and a stop) of their own.
  const pictures = grouped.filter((stop) => stop.group === grouped[0]?.group);
  expect(pictures.length).toBeGreaterThan(1);
  expect(find(view.tree(), pictures[0]?.group ?? "")?.props.focusGroup).toBe(true);
  expect(pictures.filter((stop) => stop.selected === true)).toHaveLength(1);
  view.root.unmount();
});

test("Calendar's Today is a Tab stop", async () => {
  const view = await mount(<TodayButton onPress={() => {}} />);
  expect(stops(view.tree()).map((stop) => stop.id)).toEqual([view.id("today")]);
  view.root.unmount();
});
