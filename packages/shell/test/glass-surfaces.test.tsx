/**
 * The bar's surfaces on Frost (design.html DE-4, GL-1, GL-6, CC-5, CC-6, LA-4; decisions.md D780 to D785):
 * each wears its level on a host that takes glass (its solid twin otherwise), its words in the glass's
 * inks; the bar's washes lean with its ink; a menu's lit row stays the solid accent; the OSD's segments are
 * ink; the Focus and Display pages draw their rows; a panel's own edge gives way to the compositor's.
 */

import { describe, expect, test } from "bun:test";
import { barItemColors, darkColors, GLASS, lightColors, paintedPalette, panelEdge, TRUE_BLACK, withAlpha } from "@dashi/ui";
import { type NativeEvent, type NativeTransport, render, View } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { DisplayPage, FocusPage } from "../src/control-center/lib/more-pages.tsx";
import type { ControlCenterProps } from "../src/control-center/panel.tsx";
import { BarDropdown } from "../src/menus/lib/view.tsx";
import { FlagsStore } from "../src/shared/control-center/index.ts";
import { barWashes, glassPanelEdge } from "../src/shared/glass/index.ts";
import { SwitcherPanel, SwitcherStore } from "../src/switcher/panel.tsx";
import { OsdPanel } from "../src/system/lib/osd-panel.tsx";
import { OsdStore } from "../src/system/osd-state.ts";
import { settle } from "./support/time.ts";

interface Node {
  type?: string;
  props: Record<string, unknown>;
  children?: (Node | string)[];
}
const nodesOf = (node: Node): Node[] => [node, ...(node.children ?? []).flatMap((child) => (typeof child === "string" ? [] : nodesOf(child)))];

/** Renders on a fake host; `glass`: the host says it takes glass, as dashi-comp's Metal host does. */
async function drawn(element: ReactElement, glass = true) {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const root = render(element, transport);
  await settle();
  if (glass) for (const listener of listeners) listener({ type: "protocol", nodeId: "root", patches: 0, glass: true } as NativeEvent);
  await settle();
  const nodes = () => nodesOf(JSON.parse(trees.at(-1) ?? "{}") as Node);
  const byTest = (testID: string) => nodes().find((node) => node.props.id === root.nodeId(testID));
  return { root, nodes, byTest, json: () => trees.at(-1) ?? "" };
}

const REGULAR = paintedPalette(lightColors, false, { level: "regular", tone: null }, true);

describe("a menu (D782)", () => {
  test("regular glass on a host that takes it: no edge of its own, the lit row the solid accent under onAccent", async () => {
    const entries = [
      { kind: "item" as const, label: "Undo", keys: "❖Z", action: "undo" },
      { kind: "item" as const, label: "Redo", action: null },
    ];
    const { root, byTest } = await drawn(
      <BarDropdown entries={entries} x={200} fromKeys room={{ width: 1280, height: 772 }} onChoose={() => {}} onClose={() => {}} />,
    );
    expect(byTest("menu-panel")?.props).toMatchObject({ material: "regular", cornerRadius: 10, background: GLASS.levels.regular.light.solid });
    expect(String(byTest("menu-panel")?.props.borderColor ?? "#00000000")).toBe("#00000000");
    // From the keyboard the first row is lit: the accent itself, never a wash.
    expect(byTest("menu-row:Undo")?.props.background).toBe(lightColors.selection);
    root.unmount();
  });

  test("its solid twin with the menu's edge where the host draws no glass", async () => {
    const { root, byTest } = await drawn(
      <BarDropdown entries={[{ kind: "item", label: "Undo", action: "undo" }]} x={200} onChoose={() => {}} onClose={() => {}} />,
      false,
    );
    expect(byTest("menu-panel")?.props.material).toBeUndefined();
    expect(byTest("menu-panel")?.props).toMatchObject({ borderColor: lightColors.menuEdge, background: GLASS.levels.regular.light.solid });
    root.unmount();
  });
});

describe("the bar's washes and chips (D780)", () => {
  test("an item: the ink at 8 % under the pointer, 14 % open", () => {
    expect(barWashes("#202020")).toEqual({ hover: "#20202014", open: "#20202024", chip: "#2020201a", chipHover: "#20202029" });
  });

  test("a chip on glass: primary words whatever the tone; neutral ink 10 %, a capture's ume 20 %", () => {
    expect(barItemColors("agent", REGULAR, true)).toEqual({ wash: REGULAR.agentWash, hover: withAlpha(REGULAR.agent, 0.3), ink: REGULAR.text });
    expect(barItemColors("capture", REGULAR, true)).toMatchObject({ wash: withAlpha(REGULAR.ume, 0.2), ink: REGULAR.text });
    expect(barItemColors("neutral", REGULAR, true).wash).toBe(withAlpha(REGULAR.text, 0.1));
    // Off glass, as before: the agents' own ink.
    expect(barItemColors("agent", lightColors).ink).toBe(lightColors.agentInk);
  });
});

test("a floating panel's edge: padding only under glass, the true-black hairline without it", () => {
  expect(glassPanelEdge(true, 12, true)).toEqual({ padding: 12 });
  expect(glassPanelEdge(true, 12, false)).toEqual(panelEdge(true, 12));
  expect(panelEdge(true, 12).borderColor).toBe(TRUE_BLACK.edge);
});

test("the switcher: regular glass, 14; its parts laid out on the panel's glass", async () => {
  const store = new SwitcherStore();
  store.set({
    selected: 0,
    apps: [{ appId: "files", title: "Files", count: 3, away: false }],
    windows: null,
    windowStart: 0,
    selectedWindow: null,
    query: "",
    size: { width: 900, height: 400 },
  });
  const { root, byTest } = await drawn(<SwitcherPanel store={store} identify={(app) => ({ name: app.appId, icon: "" })} />);
  const panel = byTest("switcher-panel")?.props;
  expect(panel).toMatchObject({ material: "regular", cornerRadius: 14 });
  const cell = byTest("switcher-app-0")?.props;
  // In the panel's own place: inside it, never at the surface's.
  expect(Number(cell?.left)).toBeLessThan(Number(panel?.width));
  expect(cell?.background).toBe(REGULAR.selectionWash);
  root.unmount();
});

test("the OSD: regular glass, its segments the glass's ink, an off one at 20 %", async () => {
  const store = new OsdStore();
  store.set({ kind: "volume", level: 0.5, muted: false });
  const { root, byTest, nodes } = await drawn(<OsdPanel store={store} />);
  expect(byTest("osd")?.props).toMatchObject({ material: "regular", cornerRadius: 28 });
  const backgrounds = nodes().map((node) => node.props.background);
  expect(backgrounds).toContain(REGULAR.text);
  expect(backgrounds).toContain(withAlpha(REGULAR.text, 0.2));
  root.unmount();
});

describe("Control Center's new pages (CC-5, CC-6)", () => {
  const props = (flags: FlagsStore, levels: number[] = []) =>
    ({ flags, devices: { setBrightnessLevel: (level: number) => levels.push(level) }, onSettings: () => {} }) as unknown as ControlCenterProps;

  test("Focus: each choice says until when; the one it was turned on for is on; what Focus holds back; Notifications Settings…", async () => {
    const flags = new FlagsStore(null);
    flags.set({ dnd: true, dndUntil: new Date(2026, 10, 26, 17, 48).getTime(), dndFor: "hour" });
    const { root, byTest, json } = await drawn(
      <View>
        <FocusPage props={props(flags)} onBack={() => {}} now={new Date(2026, 10, 26, 16, 48)} />
      </View>,
      false,
    );
    for (const id of ["hour", "evening", "tomorrow", "off"]) expect(byTest(`focus-${id}`)).not.toBeUndefined();
    expect(byTest("focus-hour")?.props.access).toMatchObject({ checked: true });
    expect(byTest("focus-off")?.props.access).toMatchObject({ checked: false });
    expect(json()).toContain("On for 1 hour");
    expect(json()).toContain("Banners wait in the area. Agents’ questions still ask.");
    expect(json()).toContain("Notifications Settings…");
    root.unmount();
  });

  test("Display: the screen and its level, the brightness slider, Night Shift and Dark with switches, Displays Settings…", async () => {
    const flags = new FlagsStore(null);
    const snapshot = { brightness: 0.68, night: true, dark: false } as Parameters<typeof DisplayPage>[0]["snapshot"];
    const { root, byTest, json } = await drawn(
      <View>
        <DisplayPage props={props(flags)} snapshot={snapshot} onBack={() => {}} />
      </View>,
      false,
    );
    expect(json()).toContain("Built-in · 68%");
    expect(byTest("display-brightness")).not.toBeUndefined();
    expect(byTest("display-night-switch")).not.toBeUndefined();
    expect(byTest("display-dark-switch")).not.toBeUndefined();
    expect(json()).toContain("Displays Settings…");
    root.unmount();
  });
});

test("Dark's glass palette is the twin's in Dark too", () => {
  expect(paintedPalette(darkColors, true, { level: "thin", tone: null }, true).text).not.toBe(darkColors.text);
});
