/**
 * Control Center's Sound page, the short list (sound/app-rows.tsx, sound/page.tsx): an app's row by the
 * keyboard, the way into the full mixer, and the volume slider on a development run, which writes
 * nothing to the developer's machine (control-center/devices.ts).
 */

import { describe, expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render, View } from "@mirinjs/metal";
import { useState } from "react";
import { DeviceStore } from "../src/control-center/devices.ts";
import { PageKeysContext, usePageKeys } from "../src/control-center/page-stops.ts";
import { AppSections, steppedLevel } from "../src/sound/app-rows.tsx";
import type { AppSound } from "../src/sound/apps/index.ts";
import { followOutputVolume } from "../src/sound/levels.ts";
import { SoundPage } from "../src/sound/page.tsx";
import { SoundStore } from "../src/sound/store.ts";
import { defaults, mic, monitor, quietRun, speakers, watchSettle } from "./support/sound-watch.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

const clock = fakeClockEachTest();

function host() {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const emit = (event: NativeEvent) => {
    for (const listener of listeners) listener(event);
  };
  return { trees, transport, emit };
}

const app = (key: string, extra: Partial<AppSound> = {}): AppSound => ({
  key,
  name: key,
  icon: "/icons/generic.svg",
  streams: [1],
  parts: [{ id: 1, title: "Sound", level: 0.5, muted: false, playing: true, meter: 1001 }],
  level: 0.5,
  muted: false,
  playing: true,
  output: "Speakers",
  target: null,
  ...extra,
});

describe("an app's row by the keyboard", () => {
  test("an arrow is a twentieth, within 0 to 1", () => {
    expect(steppedLevel(0.5, "right")).toBeCloseTo(0.55, 5);
    expect(steppedLevel(0.5, "left")).toBeCloseTo(0.45, 5);
    // From between two twentieths, the next one that way.
    expect(steppedLevel(0.52, "right")).toBeCloseTo(0.55, 5);
    expect(steppedLevel(1, "right")).toBe(1);
    expect(steppedLevel(0, "left")).toBe(0);
    expect(steppedLevel(Number.NaN, "right")).toBeCloseTo(0.05, 5);
  });

  test("↓ reaches the row; ← and → move its level, Space mutes it, and a muted app steps up from silence", async () => {
    const { transport, emit } = host();
    const levels: Array<[string, number]> = [];
    const muted: Array<[string, boolean]> = [];
    function Page() {
      const { pageKeys, pageKey } = usePageKeys("sound");
      const [apps] = useState([app("Helium"), app("paplay", { muted: true })]);
      return (
        <View testID="page" onWindowKeyDown={(event) => pageKey(event.key)}>
          <PageKeysContext.Provider value={pageKeys}>
            <AppSections
              apps={apps}
              recording={[]}
              onLevel={(key, level) => levels.push([key, Math.round(level * 100)])}
              onMute={(key, value) => muted.push([key, value])}
            />
          </PageKeysContext.Provider>
        </View>
      );
    }
    const root = render(<Page />, transport);
    await settle();
    ["sound-app-row:Helium", "sound-app-row:paplay"].forEach((id, index) => {
      emit({ type: "resize", nodeId: root.nodeId(id) ?? "", bounds: { x: 0, y: 10 + 54 * index, width: 320, height: 48 } });
    });
    await settle();
    const page = root.nodeId("page") ?? "";
    const key = async (name: string) => {
      emit({ type: "windowkey", nodeId: page, key: name, ctrl: false, alt: false, shift: false, meta: false, repeat: false });
      await settle();
    };
    await key("down");
    expect(root.nodeId("cc-page-focus-ring")).toBeDefined();
    await key("right");
    await key("left");
    await key("space");
    await key("down");
    await key("right");
    await key("enter");
    expect(levels).toEqual([
      ["Helium", 55],
      ["Helium", 45],
      ["paplay", 5],
    ]);
    expect(muted).toEqual([
      ["Helium", true],
      ["paplay", false],
    ]);
    root.unmount();
  });
});

describe("the way into the full mixer", () => {
  test("“Sound Settings…” is the page's last row, apps or none", async () => {
    const { trees, transport, emit } = host();
    const opened: number[] = [];
    const sound = new SoundStore({ list: async () => [], setDefault: async () => true });
    const root = render(
      <View>
        <SoundPage sound={sound} volume={null} onVolume={() => {}} onBack={() => {}} onSettings={() => opened.push(1)} />
      </View>,
      transport,
    );
    await settle();
    expect(trees.at(-1) ?? "").toContain("Sound Settings…");
    emit({ type: "press", nodeId: root.nodeId("sound-settings") ?? "", bounds: { x: 0, y: 0, width: 320, height: 48 } });
    await settle();
    expect(opened).toEqual([1]);
    root.unmount();
  });
});

describe("Control Center's volume on a development run", () => {
  const radio = { read: async () => null, set: async () => {} };

  test("the slider's level is kept in memory: nothing is written, and the host's changes no longer move it", async () => {
    const pw = monitor();
    const run = quietRun();
    const published: number[] = [];
    const devices = new DeviceStore({
      run,
      standIn: true,
      wifiRadio: radio,
      bluetoothRadio: radio,
      hasBluetoothctl: false,
      hasBrightnessctl: false,
      followVolume: followOutputVolume(pw.watch),
      volumeChanged: (volume) => published.push(volume.level),
    });
    const stop = devices.start();
    const heard = watchSettle(clock);
    pw.print([defaults("mixer-speakers"), speakers(), mic]);
    await heard();
    // The host's own volume is read and shown.
    expect(devices.getSnapshot().volume).toEqual({ level: 0.4, muted: false });

    devices.setVolumeLevel(0.8);
    await clock.advance(2000);
    expect(devices.getSnapshot().volume).toEqual({ level: 0.8, muted: false });
    expect(published).toEqual([0.8]);
    expect(run.calls.filter((call) => call.includes("set-volume") || call.includes("set-mute"))).toEqual([]);

    // The host changes its volume: this run keeps what its slider set, and a fresh read does too.
    pw.print([speakers([0.027, 0.027], true)]);
    await heard();
    await devices.refresh();
    expect(devices.getSnapshot().volume).toEqual({ level: 0.8, muted: false });
    stop();
  });

  test("the session's own run writes, as before", async () => {
    const run = quietRun();
    const pw = monitor();
    const devices = new DeviceStore({
      run,
      wifiRadio: radio,
      bluetoothRadio: radio,
      hasBluetoothctl: false,
      hasBrightnessctl: false,
      followVolume: followOutputVolume(pw.watch),
    });
    const stop = devices.start();
    pw.print([defaults("mixer-speakers"), speakers(), mic]);
    await watchSettle(clock)();
    devices.setVolumeLevel(0.8);
    await clock.advance(50);
    expect(run.calls).toContain("wpctl set-volume -l 1.0 @DEFAULT_AUDIO_SINK@ 0.80");
    stop();
  });
});
