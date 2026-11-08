import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { FlagsStore } from "../src/control-center/flags.ts";
import { BLANK_CHOICES, BLANK_COMMON, blankChoice, SLEEP_CHOICES, SLEEP_COMMON, timePills } from "../src/settings-app/controls.ts";
import { oneLeftEdge, onMixedCard } from "../src/settings-app/edge.ts";
import { findSettings } from "../src/settings-app/find.ts";
import { layoutName, layoutWords, variantWords } from "../src/settings-app/layouts.ts";
import { AboutPane } from "../src/settings-app/panes/about.tsx";
import { AppearancePane } from "../src/settings-app/panes/appearance.tsx";
import { chargeLimitTitle } from "../src/settings-app/panes/battery-laptop.tsx";
import { ControlCenterPane } from "../src/settings-app/panes/control-center.tsx";
import { DesktopDockPane } from "../src/settings-app/panes/desktop-dock.tsx";
import { KeyboardPane } from "../src/settings-app/panes/keyboard.tsx";
import { LockScreenPane } from "../src/settings-app/panes/lock-screen.tsx";
import { MousePane } from "../src/settings-app/panes/mouse.tsx";
import { NotificationsPane } from "../src/settings-app/panes/notifications.tsx";
import { deviceList, SoundPane, showsInputControls } from "../src/settings-app/panes/sound.tsx";
import { TrackpadPane } from "../src/settings-app/panes/trackpad.tsx";
import { SETTINGS_ROWS } from "../src/settings-app/registry/index.ts";
import type { PaneServices } from "../src/settings-app/services.ts";
import { PaneStoresContext } from "../src/settings-app/setting.tsx";
import { SettingsStore } from "../src/settings-app/store.ts";
import { FOLD_PAST, foldChoices } from "../src/shared/controls/fold.ts";
import { fakeMeter, LevelsStore, SoundStore } from "../src/sound/index.ts";
import type { Output } from "../src/sound/types.ts";

// The settings polish (47-settings-roast): folded pill rows, no-microphone Sound, the charge limit's title,
// one search result per setting, and one left edge per card.

const dir = mkdtempSync(join(tmpdir(), "dashi-settings-polish-rules-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 30));

async function mount(tree: ReactNode) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root: NativeRoot = render(tree, transport);
  await settle();
  return {
    root,
    has: (testID: string): boolean => Boolean(root.nodeId(testID)),
    press: async (testID: string): Promise<void> => {
      const nodeId = root.nodeId(testID);
      if (!nodeId) throw new Error(`no node ${testID}`);
      for (const listener of listeners) listener({ type: "press", nodeId });
      await settle();
    },
  };
}

const stores = () => ({ settings: new SettingsStore(join(dir, `settings-${Math.random()}.json`)), flags: new FlagsStore(null) });

// ── Four + More… ────────────────────────────────────────────────────────────

const seven = ["a", "b", "c", "d", "e", "f", "g"].map((value) => ({ value, label: value.toUpperCase() }));

test("a pill row of five or fewer shows every choice; past five, four and More…", () => {
  const five = seven.slice(0, FOLD_PAST);
  expect(foldChoices(five, "e")).toEqual({ shown: five, more: false });
  expect(foldChoices(seven, "b")).toEqual({ shown: seven.slice(0, 4), more: true });
  // The commonest, named, in the list's order whatever order they are named in.
  expect(foldChoices(seven, "c", ["g", "c", "e", "a"]).shown.map((pill) => pill.value)).toEqual(["a", "c", "e", "g"]);
});

test("a hidden value in use takes the fourth pill's place, so the row always shows what is set", () => {
  const fold = foldChoices(seven, "f", ["a", "b", "c", "d"]);
  expect(fold.shown.map((pill) => pill.value)).toEqual(["a", "b", "c", "f"]);
  expect(fold.more).toBe(true);
  // A value the list doesn't have changes nothing.
  expect(foldChoices(seven, "z", ["a", "b", "c", "d"]).shown.map((pill) => pill.value)).toEqual(["a", "b", "c", "d"]);
});

test("the timers show their four usual times; 20 minutes, set, stands fourth", () => {
  const blank = timePills(BLANK_CHOICES);
  expect(foldChoices(blank, blankChoice(300), BLANK_COMMON).shown.map((pill) => pill.label)).toEqual(["2 min", "5 min", "10 min", "Never"]);
  expect(foldChoices(blank, blankChoice(1200), BLANK_COMMON).shown.map((pill) => pill.label)).toEqual(["2 min", "5 min", "10 min", "20 min"]);
  const sleep = timePills(SLEEP_CHOICES);
  expect(foldChoices(sleep, 0, SLEEP_COMMON).shown.map((pill) => pill.label)).toEqual(["15 min", "30 min", "1 h", "Never"]);
  expect(foldChoices(sleep, 7200, SLEEP_COMMON).shown.map((pill) => pill.label)).toEqual(["15 min", "30 min", "1 h", "2 h"]);
});

test("More… opens every choice in Dashi's menu, and a hidden one picked there takes the fourth pill", async () => {
  const { TooltipLayer } = await import("@dashi/ui");
  const { View } = await import("@mirinjs/metal");
  const { FoldedChoices } = await import("../src/shared/controls/folded.tsx");
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  let value = "a";
  const tree = () => (
    <View style={{ position: "relative" }}>
      <TooltipLayer>
        <FoldedChoices testID="timer" options={seven} common={["a", "b", "c", "d"]} value={value} onChange={(next) => void (value = next)} />
      </TooltipLayer>
    </View>
  );
  const root = render(tree(), transport);
  await settle();
  const send = async (event: NativeEvent) => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  expect(root.nodeId("timer:f")).toBeUndefined();
  // A press carries the link's bounds: the menu opens under it, in the window's top layer.
  await send({ type: "press", nodeId: root.nodeId("timer:more") ?? "", bounds: { x: 600, y: 140, width: 40, height: 16 } });
  expect(root.nodeId("timer:menu:away")).toBeDefined();
  const rows = (root.lastTree() ?? "").match(/"G"/g) ?? [];
  expect(rows.length).toBeGreaterThan(0);
  root.unmount();
  value = "f";
  const again = render(tree(), transport);
  await settle();
  expect(again.nodeId("timer:f")).toBeDefined();
  expect(again.nodeId("timer:d")).toBeUndefined();
  again.unmount();
});

// ── Sound with no microphone ───────────────────────────────────────────────

const backend = (devices: Output[]) => ({ list: async () => devices, setDefault: async () => true });
const speakers: Output = { id: 1, label: "Speakers", current: true, kind: "speaker" };
const microphone: Output = { id: 2, label: "Microphone", current: true, kind: "speaker" };

function soundServices(inputs: Output[]): PaneServices {
  // A default input the system reports a volume for, as PipeWire does for a virtual source no list names.
  const levels = { read: async () => ({ level: 0.45, muted: false }), setLevel: async () => null, setMuted: async () => null };
  return {
    sound: new SoundStore(backend([speakers]), { pollMs: 60_000 }),
    inputs: new SoundStore(backend(inputs), { pollMs: 60_000 }),
    levels: new LevelsStore(levels, undefined, 60_000),
    meter: fakeMeter(),
  } as unknown as PaneServices;
}

test("which input controls belong: only with a microphone whose volume can be read", () => {
  expect(deviceList({ available: true, outputs: [] })).toBe("none");
  expect(deviceList({ available: false, outputs: [] })).toBe("unavailable");
  expect(showsInputControls({ available: true, outputs: [] }, { level: 0.45, muted: false })).toBe(false);
  expect(showsInputControls({ available: true, outputs: [microphone] }, null)).toBe(false);
  expect(showsInputControls({ available: true, outputs: [microphone] }, { level: 0.45, muted: false })).toBe(true);
});

test("Sound with no microphone: one plain row says so, and no input volume, mute or meter", async () => {
  const at = stores();
  const view = await mount(
    <PaneStoresContext.Provider value={at}>
      <SoundPane services={soundServices([])} />
    </PaneStoresContext.Provider>,
  );
  expect(view.has("sound-no-microphone")).toBe(true);
  for (const control of ["input-volume", "input-mute", "input-meter", "input-volume-group", "input-level-group"])
    expect([control, view.has(control)]).toEqual([control, false]);
  // The output keeps its own.
  expect(view.has("output-volume")).toBe(true);
  view.root.unmount();

  const withMicrophone = await mount(
    <PaneStoresContext.Provider value={at}>
      <SoundPane services={soundServices([microphone])} />
    </PaneStoresContext.Provider>,
  );
  expect(withMicrophone.has("sound-no-microphone")).toBe(false);
  expect(withMicrophone.has("input-volume")).toBe(true);
  expect(withMicrophone.has("input-mute")).toBe(true);
  withMicrophone.root.unmount();
});

// ── The charge limit ───────────────────────────────────────────────────────

test("the charge limit's title names the limit it is at, never an old one", () => {
  expect(chargeLimitTitle(80)).toBe("Stop charging at 80%");
  // The slider moving: the title follows each value, before it is saved.
  for (const limit of [75, 60, 55]) expect(chargeLimitTitle(limit)).toBe(`Stop charging at ${limit}%`);
  // Full: the switch is off and says what it would do.
  expect(chargeLimitTitle(100)).toBe("Stop charging early");
});

// ── Search ─────────────────────────────────────────────────────────────────

test("search lists each setting once, with its own glyph and its pane", () => {
  const night = findSettings("night");
  const ids = night.map((found) => found.id);
  expect(ids.filter((id) => id.startsWith("displays/night-shift"))).toEqual(["displays/night-shift"]);
  expect(night[0]).toMatchObject({ id: "displays/night-shift", where: "Displays" });
  // The row's own glyph, not the pane's monitor.
  expect(night[0]?.glyph).toBe(SETTINGS_ROWS.find((row) => row.id === "displays/night-shift")?.glyph);
  // A part is found when the words find it and not its setting.
  expect(findSettings("warmth").map((found) => found.id)).toContain("displays/night-shift-warmth");
  // No setting is listed twice, whatever is typed.
  for (const query of ["night", "charge", "battery", "sound", "scroll", "dark", "display"]) {
    const found = findSettings(query);
    const settings = found.map((each) => SETTINGS_ROWS.find((row) => row.id === each.id)?.partOf ?? each.id);
    expect([query, settings.length]).toEqual([query, new Set(settings).size]);
  }
  // A pane and its own switch of the same name are one result.
  expect(findSettings("bluetooth").filter((found) => found.label === "Bluetooth")).toHaveLength(1);
});

// ── The keyboard layout's one name ─────────────────────────────────────────

test("the layout has one name: the variant's own when one is chosen", () => {
  const xkb = {
    layouts: [{ id: "us", name: "English (US)" }],
    variants: [{ id: "euro", layout: "us", name: "English (US, euro on 5)" }],
  };
  expect(layoutName(xkb, "us", undefined)).toBe("English (US)");
  expect(layoutName(xkb, "us", "euro")).toBe("English (US, euro on 5)");
  expect(layoutName(xkb, undefined, undefined)).toBe("English (US)");
  // Recently changed says it by the same name, not its id.
  expect(layoutWords("us", xkb)).toBe("English (US)");
  expect(variantWords("euro", xkb)).toBe("English (US, euro on 5)");
  expect(layoutWords("zz", xkb)).toBe("zz");
});

// ── One left edge ──────────────────────────────────────────────────────────

test("a card keeps one left edge: every row has a knob, or none does", () => {
  expect(oneLeftEdge([true, true, true])).toBe(true);
  expect(oneLeftEdge([false, false])).toBe(true);
  expect(oneLeftEdge([])).toBe(true);
  expect(oneLeftEdge([true, false, true])).toBe(false);
});

test("every pane drawn here keeps one left edge in each of its cards", async () => {
  const mixed: string[] = [];
  const stop = onMixedCard((card) => mixed.push(card));
  const at = stores();
  const auto = stores();
  auto.settings.patch("appearance", { auto: true });
  const info = {
    version: "0.5.0",
    os: null,
    hostname: "alexk-laptop",
    base: "Fedora Linux 44",
    kernel: "6.17",
    processor: { model: "AMD Ryzen AI 9 HX 370", threads: 24 },
    memory: 32 * 1024 ** 3,
    gpus: ["Radeon 890M"],
    disk: { total: 1e12, free: 4e11 },
  };
  const panes: Array<[string, ReactNode, typeof at]> = [
    ["appearance", <AppearancePane key="a" flags={at.flags} settings={at.settings} />, at],
    ["appearance (Automatic)", <AppearancePane key="b" flags={auto.flags} settings={auto.settings} />, auto],
    ["trackpad", <TrackpadPane key="c" settings={at.settings} />, at],
    ["mouse", <MousePane key="d" settings={at.settings} />, at],
    ["desktop & dock", <DesktopDockPane key="e" />, at],
    ["notifications", <NotificationsPane key="f" />, at],
    ["lock screen", <LockScreenPane key="g" settings={at.settings} lock={() => {}} show={() => {}} />, at],
    ["keyboard", <KeyboardPane key="h" settings={at.settings} layouts={{ layouts: [{ id: "us", name: "English (US)" }], variants: [] }} />, at],
    ["about", <AboutPane key="i" about={() => info as never} openSetup={() => {}} />, at],
    ["sound", <SoundPane key="j" services={soundServices([])} />, at],
    ["sound (a microphone)", <SoundPane key="k" services={soundServices([microphone])} />, at],
    ["control center", <ControlCenterPane key="l" editor={null} />, at],
  ];
  for (const [name, pane, its] of panes) {
    const before = mixed.length;
    const view = await mount(<PaneStoresContext.Provider value={its}>{pane}</PaneStoresContext.Provider>);
    expect([name, mixed.slice(before)]).toEqual([name, []]);
    view.root.unmount();
  }
  stop();
});

test("the rule hears a card that mixes its edges", async () => {
  const { Group, Item } = await import("../src/settings-app/ui.tsx");
  const mixed: string[] = [];
  const stop = onMixedCard((card) => mixed.push(card));
  const view = await mount(
    <Group testID="mixed-card">
      <Item label="With a knob" glyph="<svg/>" />
      <Item label="Without" />
    </Group>,
  );
  expect(mixed).toContain("mixed-card");
  view.root.unmount();
  stop();
});
