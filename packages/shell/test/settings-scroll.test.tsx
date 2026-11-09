import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Caption as UiCaption, Group as UiGroup, Row as UiRow } from "@dashi/ui";
import { type NativeTransport, render, ScrollView } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { FlagsStore } from "../src/control-center/flags.ts";
import { INITIAL_REGION, type RegionStore } from "../src/region/store.ts";
import type { PaneContext } from "../src/settings-app/context.ts";
import { DateTimePane } from "../src/settings-app/panes/date-time.tsx";
import { Nav, type PaneId } from "../src/settings-app/panes.ts";
import { PAGE } from "../src/settings-app/row.tsx";
import { PaneStoresContext } from "../src/settings-app/setting.tsx";
import { SIDEBAR } from "../src/settings-app/sidebar.tsx";
import { SettingsStore } from "../src/settings-app/store.ts";
import { Caption, Group, Page, Row } from "../src/settings-app/ui.tsx";
import { SETTINGS_WINDOW, SettingsWindow } from "../src/settings-app/view.tsx";
import type { SetupContext } from "../src/setup/context.ts";
import { ExtrasStore } from "../src/setup/extras/store.ts";
import { PAGE_INFO } from "../src/setup/flow.ts";
import { Frame } from "../src/setup/frame.tsx";
import { AgentsPage } from "../src/setup/pages/agents.tsx";
import { ExtrasPage } from "../src/setup/pages/extras.tsx";
import { INK_SLIDER } from "../src/shared/controls/ink-slider.tsx";

// A Settings page (and a Setup page) scrolls to its last line at any height. mirin's layout
// (its vendored taffy 0.9) sizes a column wrongly when a child that keeps its
// size (`flexShrink: 0`) has a negative margin along the column: the column
// comes out shorter by the margin times that child's height, so a page whose
// Caption sat 4 under a card lost almost all of its scroll range (the window
// small, the end of Appearance, Displays or Battery & Power out of reach).
// @dashi/ui's Caption did the same with 8. Until mirin's layout is fixed, no
// view on these pages combines the two.

const dir = mkdtempSync(join(tmpdir(), "dashi-settings-scroll-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 30));

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;
const below0 = (value: unknown): boolean => typeof value === "number" && value < 0;

/** Views that keep their size and have a negative margin along their parent's main axis: what shrinks the parent in mirin's layout. */
function pinnedPulls(node: Node, out: string[] = []): string[] {
  const row = node.props.direction === "row";
  for (const child of node.children ?? []) {
    if (!isNode(child)) continue;
    const { props } = child;
    const pulled = row ? below0(props.marginLeft) || below0(props.marginRight) : below0(props.marginTop) || below0(props.marginBottom);
    if (pulled && props.shrink === false) out.push(String(props.id));
    pinnedPulls(child, out);
  }
  return out;
}

function findNode(node: Node, id: string): Node | undefined {
  if (node.props.id === id) return node;
  return (node.children ?? []).map((child) => (isNode(child) ? findNode(child, id) : undefined)).find(Boolean);
}

async function lastTree(tree: ReactNode): Promise<Node> {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (sent) => trees.push(sent), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(tree, transport);
  await settle();
  root.unmount();
  return JSON.parse(trees.at(-1) ?? "{}") as Node;
}

const stores = () => ({ settings: new SettingsStore(join(dir, `settings-${Math.random()}.json`)), flags: new FlagsStore(null) });

test("a caption under a card is pulled up without keeping its size, one over a card keeps it", async () => {
  const tree = await lastTree(
    <Page title="Test">
      <Caption above>Over</Caption>
      <Group>
        <Row label="One" />
      </Group>
      <Caption>Under</Caption>
    </Page>,
  );
  expect(pinnedPulls(tree)).toEqual([]);
  const views: Node[] = [];
  const walk = (node: Node): void => {
    views.push(node);
    for (const child of node.children ?? []) if (isNode(child)) walk(child);
  };
  walk(tree);
  expect(views.some((view) => view.props.marginTop === -4 && view.props.shrink === undefined)).toBe(true);
  expect(views.some((view) => view.props.marginTop === 6 && view.props.shrink === false)).toBe(true);
});

test("Date & Time's line under its first card is pulled up the same way", async () => {
  const at = stores();
  const region = { subscribe: () => () => {}, getSnapshot: () => INITIAL_REGION, start: async () => {} } as unknown as RegionStore;
  const tree = await lastTree(
    <PaneStoresContext.Provider value={at}>
      <DateTimePane region={region} settings={at.settings} />
    </PaneStoresContext.Provider>,
  );
  expect(pinnedPulls(tree)).toEqual([]);
});

/** The panes that draw with no machine behind them (the rest need the services the shell starts). */
const STANDALONE: readonly PaneId[] = [
  "appearance",
  "wallpaper",
  "desktop-dock",
  "control-center",
  "notifications",
  "graphics",
  "trackpad",
  "mouse",
  "passwords",
  "lock-screen",
  "recent",
];

test("no pane keeps a view's size while pulling it up, so every page keeps its scroll range", async () => {
  for (const pane of STANDALONE) {
    const at = stores();
    const ctx = { ...at, services: {} } as unknown as PaneContext;
    const nav = new Nav();
    nav.select(pane);
    const tree = await lastTree(<SettingsWindow ctx={ctx} nav={nav} />);
    expect((tree.children ?? []).length).toBeGreaterThan(0);
    expect({ pane, pulled: pinnedPulls(tree) }).toEqual({ pane, pulled: [] });
  }
});

test("@dashi/ui's caption under a group is pulled up the same way (Setup's pages and the apps)", async () => {
  const tree = await lastTree(
    <ScrollView testID="page">
      <UiCaption above>Over</UiCaption>
      <UiGroup>
        <UiRow label="One" />
      </UiGroup>
      <UiCaption>Under</UiCaption>
    </ScrollView>,
  );
  expect((tree.children ?? []).length).toBe(3);
  expect(pinnedPulls(tree)).toEqual([]);
});

test("Setup's Agents and Extras pages, which end with such captions, keep their scroll range", async () => {
  const at = stores();
  const extras = new ExtrasStore({
    detect: async () => ({ nvidia: true, nvidiaInstalled: false, gamingInstalled: false }),
    runHelper: async () => ({ ok: true }),
    software: { hasFlatpak: async () => true, installed: async () => [], install: async () => {} },
  } as unknown as ConstructorParameters<typeof ExtrasStore>[0]);
  extras.choose({ flathub: true });
  const ctx = { ...at, extras } as unknown as SetupContext;
  for (const [id, page] of [
    ["agents", <AgentsPage key="agents" ctx={ctx} />],
    ["extras", <ExtrasPage key="extras" ctx={ctx} />],
  ] as const) {
    const view = { page: id, index: 0, count: 2, first: true, last: false };
    const trees: string[] = [];
    const transport: NativeTransport = { send: (sent) => trees.push(sent), onEvent() {}, onClose() {}, simulate() {}, close() {} };
    const root = render(
      <Frame info={PAGE_INFO[id]} view={view} onContinue={() => {}} onBack={() => {}} onSkip={() => {}}>
        {page}
      </Frame>,
      transport,
    );
    await settle();
    const tree = JSON.parse(trees.at(-1) ?? "{}") as Node;
    expect(pinnedPulls(tree)).toEqual([]);
    // The page's column in the frame's scroll view is never shorter than its content.
    const content = findNode(tree, root.nodeId(`setup-page:${id}:content`) ?? "");
    expect(content?.props.shrink).toBe(false);
    expect((content?.children ?? []).length).toBeGreaterThan(2);
    root.unmount();
  }
});

test("a page's content column never shrinks below its content, whose height is the scroll range", async () => {
  const trees: string[] = [];
  const transport: NativeTransport = { send: (sent) => trees.push(sent), onEvent() {}, onClose() {}, simulate() {}, close() {} };
  const root = render(
    <Page title="Test">
      <Group>
        <Row label="One" />
      </Group>
    </Page>,
    transport,
  );
  await settle();
  const tree = JSON.parse(trees.at(-1) ?? "{}") as Node;
  const page = findNode(tree, root.nodeId("pane:Test") ?? "");
  const content = findNode(tree, root.nodeId("pane:Test:content") ?? "");
  expect(page?.props.scroll).toBe(true);
  expect(page?.children?.filter(isNode).map((child) => child.props.id)).toContain(content?.props.id);
  expect(content?.props.shrink).toBe(false);
  root.unmount();
});

test("a row's words keep their least width beside a control, so in a narrow window the pills wrap instead", async () => {
  const tree = await lastTree(
    <Page title="Test">
      <Group>
        <Row label="First day of the week" glyph="<svg/>" />
      </Group>
    </Page>,
  );
  const widths: unknown[] = [];
  const walk = (node: Node): void => {
    if (node.props.flex === 1 && node.props.minWidth !== undefined) widths.push(node.props.minWidth);
    for (const child of node.children ?? []) if (isNode(child)) walk(child);
  };
  walk(tree);
  expect(widths).toContain(PAGE.words);
});

test("the window's least size: the sidebar beside the widest row that can't fold, and a page's title over the tallest hero", () => {
  const widestRow = 8 + PAGE.knob + 12 + PAGE.words + 12 + INK_SLIDER.width + 16;
  // Nothing to spare: at its words' least width a slider's row keeps its height (mirin's taffy fork).
  expect(SETTINGS_WINDOW.minWidth).toBe(SIDEBAR.width + 2 * PAGE.margin + widestRow);
  expect(SETTINGS_WINDOW.minWidth).toBe(744);
  expect(SETTINGS_WINDOW.minHeight).toBeGreaterThanOrEqual(PAGE.title + 207 + PAGE.margin);
  expect(SETTINGS_WINDOW.minWidth).toBeLessThan(SETTINGS_WINDOW.width);
  expect(SETTINGS_WINDOW.minHeight).toBeLessThan(SETTINGS_WINDOW.height);
});
