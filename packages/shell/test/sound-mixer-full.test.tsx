/**
 * The full mixer in Settings › Sound (settings-app/lib/panes/sound-apps.tsx, sound-recording.tsx): an app's
 * streams fold under it, each with its own slider and mute; the meters run only for what shows; the apps
 * that record have their level, mute and microphone. And what agents reach of it (lib/machine-sound.ts).
 */

import { describe, expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render, View } from "@mirinjs/metal";
import { mixerMethods } from "../src/settings-app/lib/machine-sound.ts";
import { AppsCard } from "../src/settings-app/lib/panes/sound-apps.tsx";
import { meterNodes } from "../src/settings-app/lib/panes/sound-mixer-parts.tsx";
import { RecordingCard } from "../src/settings-app/lib/panes/sound-recording.tsx";
import { AppMixer } from "../src/sound/apps/index.ts";
import type { LevelMeter } from "../src/sound/meter.ts";
import { streamMeters } from "../src/sound/stream-meters.ts";
import { vmGraph } from "./fixtures/pw-graph.ts";
import { owner, pushedGraph, recordingControl } from "./support/sound-mixer.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

fakeClockEachTest();

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
  const press = (nodeId: string | undefined) => {
    if (nodeId === undefined) throw new Error("no node");
    for (const listener of listeners) listener({ type: "press", nodeId, bounds: { x: 400, y: 200, width: 128, height: 28 } });
  };
  return { trees, transport, press };
}

/** The mixer on the proof's graph, a control that records what it is asked, and meters that only count. */
function started() {
  const graph = pushedGraph();
  const control = recordingControl();
  const mixer = new AppMixer({ graph, control, owner });
  mixer.start();
  graph.push(vmGraph());
  const listening = new Set<number>();
  const meters = streamMeters(
    (serial): LevelMeter => ({
      start() {
        listening.add(serial);
        return () => listening.delete(serial);
      },
    }),
  );
  return { control, mixer, meters, listening };
}

describe("Settings' mixer", () => {
  test("a folded app is one row; a press opens its streams, each with its own slider and mute", async () => {
    const { control, mixer, meters } = started();
    const { trees, transport, press } = host();
    const root = render(
      <View>
        <AppsCard mixer={mixer} meters={meters} />
      </View>,
      transport,
    );
    await settle();
    expect(root.nodeId("sound-app-row:helium")).toBeDefined();
    expect(root.nodeId("sound-stream:84")).toBeUndefined();
    expect(trees.at(-1) ?? "").toContain("2 streams");
    // One stream: nothing to open.
    expect(root.nodeId("sound-app:sound:pw-play:fold")).toBeUndefined();

    press(root.nodeId("sound-app:helium:fold"));
    await settle();
    expect(root.nodeId("sound-stream:84")).toBeDefined();
    expect(root.nodeId("sound-stream:66")).toBeDefined();
    const open = trees.at(-1) ?? "";
    for (const words of ["Hide streams", "Playback", "Playback 2", "Paused"]) expect(open).toContain(words);

    press(root.nodeId("sound-stream:66-mute"));
    await settle();
    expect(control.calls).toEqual(["mute 66 true"]);
    expect(
      mixer
        .getSnapshot()
        .apps.find((app) => app.key === "helium")
        ?.parts.map((part) => part.muted),
    ).toEqual([false, true]);

    press(root.nodeId("sound-app:helium:fold"));
    await settle();
    expect(root.nodeId("sound-stream:84")).toBeUndefined();
    root.unmount();
    mixer.stop();
  });

  test("every control is named for a screen reader by what it changes", async () => {
    const { mixer, meters } = started();
    const { trees, transport, press } = host();
    const root = render(
      <View>
        <AppsCard mixer={mixer} meters={meters} />
        <RecordingCard mixer={mixer} meters={meters} />
      </View>,
      transport,
    );
    await settle();
    press(root.nodeId("sound-app:helium:fold"));
    await settle();
    const tree = trees.at(-1) ?? "";
    for (const name of [
      "Helium volume",
      "Mute Helium",
      "Play Helium on",
      "Helium, Playback 2 volume",
      "Mute Helium, Playback 2",
      "Signal input volume",
      "Mute Signal input",
      "Record Signal from",
      "Level meter",
    ])
      expect(tree).toContain(name);
    root.unmount();
    mixer.stop();
  });

  test("meters run only for what shows: the app's while folded, each stream's when open, none once it is gone", async () => {
    const { mixer, meters, listening } = started();
    expect(listening.size).toBe(0);
    const { transport, press } = host();
    const root = render(
      <View>
        <AppsCard mixer={mixer} meters={meters} />
      </View>,
      transport,
    );
    await settle();
    // The playing streams of the four apps (Helium's second tab is paused); paplay is muted, so its meter reads empty and doesn't listen.
    expect([...listening].sort()).toEqual([1064, 1084, 1091]);
    press(root.nodeId("sound-app:helium:fold"));
    await settle();
    // Open, the stream's own meter listens to the same node: still one recorder for it.
    expect([...listening].sort()).toEqual([1064, 1084, 1091]);
    root.unmount();
    await settle();
    expect(listening.size).toBe(0);
    mixer.stop();
  });

  test("a row's meter listens to each part that plays now, once", () => {
    const part = (meter: number | null, playing = true) => ({ id: 1, title: "Sound", level: 1, muted: false, playing, meter });
    expect(meterNodes([part(1084), part(1066, false), part(null), part(1084)])).toEqual([1084]);
  });

  test("the apps that record: the input's meter, the app's level and mute, and the microphone it records from", async () => {
    const { control, mixer, meters, listening } = started();
    const { trees, transport, press } = host();
    const root = render(
      <View>
        <RecordingCard mixer={mixer} meters={meters} />
      </View>,
      transport,
    );
    await settle();
    for (const key of ["sound:pw-record", "signal", "sound:OBS"]) expect(root.nodeId(`sound-recording-row:${key}`)).toBeDefined();
    // pw-record and Signal share the microphone's meter; OBS's is on the speakers it records.
    expect([...listening].sort()).toEqual([1051, 1062]);
    press(root.nodeId("sound-recording:signal-mute"));
    await settle();
    expect(control.calls).toEqual(["mute 94 true"]);
    // "Record from": Default and the microphone, in Dashi's menu.
    press(root.nodeId("sound-record-from:signal"));
    await settle();
    expect(root.nodeId("sound-record-from:signal:menu")).toBeDefined();
    expect(trees.at(-1) ?? "").toContain("Microphone");
    root.unmount();
    mixer.stop();
  });
});

describe("the mixer for agents", () => {
  test("an app's input, level and mute; what records this computer's own sound keeps what it records", async () => {
    const { control, mixer } = started();
    const methods = mixerMethods(() => mixer);
    expect(await methods.setAppInput("signal", { input: "microphone", level: 0.5 })).toEqual({
      ok: true,
      app: { name: "Signal", input: "Microphone", level: 0.5, muted: false, recordsFrom: "Microphone" },
    });
    expect(await methods.setAppInput("Signal", { input: "Default", muted: true })).toMatchObject({ ok: true, app: { muted: true, recordsFrom: "default" } });
    expect(await methods.setAppInput("Signal", { input: "Speakers" })).toEqual({ ok: false, reason: "no-input" });
    expect(await methods.setAppInput("Helium", { muted: true })).toEqual({ ok: false, reason: "none" });
    expect(await methods.setAppInput("OBS", { input: "Microphone" })).toEqual({ ok: false, reason: "own-sound" });
    expect(await methods.setAppInput("OBS", { muted: true })).toMatchObject({ ok: true, app: { input: "this computer's sound", muted: true } });
    expect(control.calls).toEqual(["level 94 0.5", "target 94 mixer-mic#1062", "mute 94 true", "target 94 default", "mute 96 true"]);
    mixer.stop();
  });

  test("an app's output still goes by its name, and its streams are read when it has several", async () => {
    const { control, mixer } = started();
    const methods = mixerMethods(() => mixer);
    const moved = await methods.setAppVolume("Helium", { output: "speakers", level: 0.4 });
    expect(moved).toMatchObject({ ok: true, app: { name: "Helium", level: 0.4, output: "Speakers" } });
    expect(moved.ok && moved.app.streams).toEqual([
      { title: "Playback", playing: true, level: 0.4, muted: false },
      { title: "Playback 2", playing: false, level: 0.4, muted: false },
    ]);
    const one = await methods.setAppVolume("pw-play", { muted: true });
    expect(one.ok && one.app.streams).toEqual([]);
    expect(await methods.setAppVolume("Helium", { output: "Microphone" })).toEqual({ ok: false, reason: "no-output" });
    expect(control.calls).toEqual(["level 84,66 0.4", "target 84,66 mixer-speakers#1051", "mute 64 true"]);
    mixer.stop();
  });
});
