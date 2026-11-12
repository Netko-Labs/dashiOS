import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { AppearancePane } from "../src/settings-app/appearance.tsx";
import { ControlCenterPane } from "../src/settings-app/control-center.tsx";
import { KeyboardPane } from "../src/settings-app/keyboard.tsx";
import { AboutPane } from "../src/settings-app/lib/panes/about.tsx";
import { DesktopDockPane } from "../src/settings-app/lib/panes/desktop-dock.tsx";
import { LockScreenPane } from "../src/settings-app/lib/panes/lock-screen.tsx";
import { MousePane } from "../src/settings-app/lib/panes/mouse.tsx";
import { NotificationsPane } from "../src/settings-app/lib/panes/notifications.tsx";
import { deviceList, SoundPane, showsInputControls } from "../src/settings-app/lib/panes/sound.tsx";
import { TrackpadPane } from "../src/settings-app/lib/panes/trackpad.tsx";
import { PaneStoresContext } from "../src/settings-app/lib/setting.tsx";
import type { PaneServices } from "../src/settings-app/services.ts";
import { SettingsStore } from "../src/settings-app/store.ts";
import { oneLeftEdge, onMixedCard } from "../src/shared/cards/edge.ts";
import { FlagsStore } from "../src/shared/control-center/flags.ts";
import { LevelsStore } from "../src/sound/levels-store.ts";
import { fakeMeter } from "../src/sound/meter.ts";
import { SoundStore } from "../src/sound/store.ts";
import type { Output } from "../src/sound/types.ts";
import { settle } from "./support/time.ts";

// The settings polish (47-settings-roast): no-microphone Sound, and one left edge per card.

const dir = mkdtempSync(join(tmpdir(), "dashi-settings-polish-rules-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
  const { Group } = await import("../src/shared/cards/index.ts");
  const { Row: Item } = await import("../src/settings-app/lib/row.tsx");
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
