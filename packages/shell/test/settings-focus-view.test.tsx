import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Appearance, darkColors, lightColors } from "@dashi/ui";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { FlagsStore } from "../src/control-center/flags.ts";
import type { PaneContext } from "../src/settings-app/context.ts";
import { Nav, PANES, SIDEBAR_PANES } from "../src/settings-app/panes.ts";
import { SettingsStore } from "../src/settings-app/store.ts";
import { SettingsWindow } from "../src/settings-app/view.tsx";

// The Settings window and the keyboard (KB-1, KB-2): its ring is kombu in
// both modes, and its sidebar is one Tab stop whose arrows choose the pane.

const dir = mkdtempSync(join(tmpdir(), "dashi-settings-focus-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 20));

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

/** Every focusable view under `node`, with the ring it draws (the nearest `focusRingColor` up; null is Metal's blue). */
function stops(node: Node, ring: unknown = null, out: { id: string; ring: unknown }[] = []): { id: string; ring: unknown }[] {
  const own = node.props.focusRingColor ?? ring;
  if (node.props.focusable === true) out.push({ id: String(node.props.id), ring: own });
  for (const child of node.children ?? []) if (isNode(child)) stops(child, own, out);
  return out;
}

async function mount(dark: boolean) {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const settings = new SettingsStore(join(dir, `settings-${Math.random()}.json`));
  const ctx = { settings, flags: new FlagsStore(null), services: {} } as unknown as PaneContext;
  const nav = new Nav();
  const root = render(
    <Appearance dark={dark}>
      <SettingsWindow ctx={ctx} nav={nav} />
    </Appearance>,
    transport,
  );
  await settle();
  const tree = (): Node => JSON.parse(trees.at(-1) ?? "{}") as Node;
  const id = (testID: string): string => root.nodeId(testID) ?? "";
  return { root, nav, tree, id };
}

test("Settings rings every control in kombu, Light and Dark (KB-2)", async () => {
  for (const [dark, colors] of [
    [false, lightColors],
    [true, darkColors],
  ] as const) {
    const view = await mount(dark);
    const window = find(view.tree(), view.id("settings-window"));
    expect(window?.props.focusRingColor).toBe(colors.focusRing);
    const all = stops(view.tree());
    expect(all.length).toBeGreaterThan(PANES.length - 1);
    expect(all.filter((stop) => stop.ring !== colors.focusRing)).toEqual([]);
    view.root.unmount();
  }
});

test("the sidebar is one focus group that selects as the arrows move, holding every pane", async () => {
  const view = await mount(false);
  const group = find(view.tree(), view.id("settings-sidebar-panes"));
  expect(group?.props).toMatchObject({ focusGroup: true, selectsOnFocus: true });
  const rows = stops(group as Node).map((stop) => stop.id);
  const listed = SIDEBAR_PANES.filter((pane) => !pane.optional).map((pane) => view.id(`sidebar:${pane.id}`));
  expect(rows).toEqual(listed);
  // No other group sits between a row and the sidebar's: ↓ crosses from one run of panes to the next.
  const nested = (node: Node, inside: boolean): boolean =>
    (inside && node.props.focusGroup === true) || (node.children ?? []).some((child) => isNode(child) && nested(child, true));
  expect((group?.children ?? []).some((child) => isNode(child) && nested(child, true))).toBe(false);
  view.root.unmount();
});
