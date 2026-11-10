/**
 * The outputs, the levels, and Control Center's slider and the menu bar's speaker following the session's
 * one pw-dump --monitor (sound/apps/watch.ts) instead of polling.
 */

import { describe, expect, test } from "bun:test";
import { DeviceStore } from "../src/control-center/devices.ts";
import { pipewireBackend, shadowBackend } from "../src/sound/backend.ts";
import { followOutputVolume, shadowLevels, wpctlLevels } from "../src/sound/levels.ts";
import { LevelsStore } from "../src/sound/levels-store.ts";
import { SoundStore } from "../src/sound/store.ts";
import { SystemStore } from "../src/system/store.ts";
import { defaults, headphones, mic, monitor, quietRun, speakers, watchSettle } from "./support/sound-watch.ts";
import { fakeClockEachTest } from "./support/time.ts";

const clock = fakeClockEachTest();
const settle = watchSettle(clock);

describe("the outputs follow PipeWire", () => {
  async function opened(pw: ReturnType<typeof monitor>, backend = pipewireBackend(quietRun(), pw.watch)) {
    const store = new SoundStore(backend, { pollMs: 5 });
    store.open();
    pw.print([defaults("mixer-speakers"), speakers(), mic]);
    await settle();
    return store;
  }

  test("an output added, the default changed, an output removed: at once, and nothing polls", async () => {
    const pw = monitor();
    const run = quietRun();
    const store = await opened(pw, pipewireBackend(run, pw.watch));
    expect(store.getSnapshot()).toMatchObject({ available: true, outputs: [{ id: 51, label: "Speakers", current: true, kind: "speaker" }] });

    pw.print([headphones()]);
    await settle();
    expect(store.getSnapshot().outputs.map((output) => [output.label, output.current, output.kind])).toEqual([
      ["Speakers", true, "speaker"],
      ["Headphones", false, "headphones"],
    ]);

    pw.print([defaults("mixer-headphones")]);
    await settle();
    expect(store.getSnapshot().outputs.map((output) => output.current)).toEqual([false, true]);

    pw.print([{ id: 51, info: null }]);
    await settle();
    expect(store.getSnapshot().outputs.map((output) => output.label)).toEqual(["Headphones"]);

    // One read as the page opened; no more, though the poll would have run many times by now.
    expect(run.calls.filter((call) => call === "pw-dump")).toHaveLength(1);
    store.close();
  });

  test("closed, the list no longer follows", async () => {
    const pw = monitor();
    const store = await opened(pw);
    store.close();
    expect(pw.stops).toBe(1);
    pw.print([headphones()]);
    await settle();
    expect(store.getSnapshot().outputs).toHaveLength(1);
  });

  test("the inputs follow too", async () => {
    const pw = monitor();
    const backend = pipewireBackend(quietRun(), pw.watch);
    const followInputs = backend.followInputs;
    expect(followInputs).toBeDefined();
    const lists: string[][] = [];
    const stop = followInputs?.((list) => lists.push(list.map((input) => `${input.label}${input.current ? " ✓" : ""}`)));
    pw.print([defaults("mixer-speakers"), speakers(), mic]);
    await settle();
    expect(lists.at(-1)).toEqual(["Microphone ✓"]);
    stop?.();
  });

  test("a development run: the host's changes show, the output chosen here stays chosen, nothing is written", async () => {
    const pw = monitor();
    const run = quietRun();
    const store = await opened(pw, shadowBackend(pipewireBackend(run, pw.watch)));
    pw.print([headphones()]);
    await settle();
    // The choice reads the lists once (a pw-dump each), and writes nothing.
    const read = pipewireBackend(async (command) => (command[0] === "pw-dump" ? JSON.stringify([defaults("mixer-speakers"), speakers(), headphones()]) : null));
    const shadow = shadowBackend({ ...read, follow: pipewireBackend(run, pw.watch).follow });
    const chosen = new SoundStore(shadow);
    chosen.open();
    await settle();
    await chosen.choose(56);
    pw.print([speakers([0.5, 0.5])]);
    await settle();
    expect(chosen.getSnapshot().outputs.map((output) => [output.label, output.current])).toEqual([
      ["Speakers", false],
      ["Headphones", true],
    ]);
    expect(store.getSnapshot().outputs.map((output) => output.label)).toEqual(["Speakers", "Headphones"]);
    expect(run.calls.filter((call) => call.startsWith("wpctl set"))).toEqual([]);
    store.close();
    chosen.close();
  });
});

describe("the levels follow PipeWire", () => {
  test("the volume and mute changed elsewhere (wpctl, a key), and the default changed", async () => {
    const pw = monitor();
    const store = new LevelsStore(wpctlLevels(quietRun(), pw.watch), undefined, 5);
    store.open();
    pw.print([defaults("mixer-speakers"), speakers(), headphones(), mic]);
    await settle();
    expect(store.getSnapshot()).toEqual({ output: { level: 0.4, muted: false }, input: { level: 0.5, muted: false } });

    // wpctl set-volume @DEFAULT_AUDIO_SINK@ 0.6: PipeWire stores its cube.
    pw.print([speakers([0.216, 0.216])]);
    await settle();
    expect(store.getSnapshot().output).toEqual({ level: 0.6, muted: false });

    pw.print([speakers([0.216, 0.216], true)]);
    await settle();
    expect(store.getSnapshot().output).toEqual({ level: 0.6, muted: true });

    // The default moved to the headphones: the slider is theirs now.
    pw.print([defaults("mixer-headphones")]);
    await settle();
    expect(store.getSnapshot().output).toEqual({ level: 0.6, muted: false });
    pw.print([headphones([0.001, 0.001])]);
    await settle();
    expect(store.getSnapshot().output).toEqual({ level: 0.1, muted: false });
    store.close();
  });

  test("a slider's set isn't undone by an older word", async () => {
    const pw = monitor();
    let truth = { level: 0.4, muted: false };
    const levels = {
      ...wpctlLevels(quietRun(), pw.watch),
      read: async () => truth,
      setLevel: async (_side: unknown, level: number) => (truth = { level, muted: false }),
    };
    const store = new LevelsStore(levels, undefined, 5);
    store.open();
    pw.print([defaults("mixer-speakers"), speakers(), mic]);
    await settle();
    await store.setLevel("output", 0.8);
    // The word for a write before this one comes late: it is not shown.
    pw.print([speakers([0.343, 0.343])]);
    await settle();
    expect(store.getSnapshot().output).toEqual({ level: 0.8, muted: false });
    pw.print([speakers([0.512, 0.512])]);
    await settle();
    expect(store.getSnapshot().output).toEqual({ level: 0.8, muted: false });
    store.close();
  });

  test("a development run: the host's changes show, a level set here stays, nothing is written", async () => {
    const pw = monitor();
    const run = quietRun();
    const real = wpctlLevels(run, pw.watch);
    const store = new LevelsStore(shadowLevels({ ...real, read: async () => ({ level: 0.4, muted: false }) }), undefined, 5);
    store.open();
    pw.print([defaults("mixer-speakers"), speakers(), mic]);
    await settle();
    pw.print([speakers([0.216, 0.216])]);
    await settle();
    expect(store.getSnapshot().output?.level).toBe(0.6);
    await store.setLevel("output", 0.2);
    await clock.advance(1100);
    pw.print([speakers([0.729, 0.729])]);
    await settle();
    expect(store.getSnapshot().output).toEqual({ level: 0.2, muted: false });
    expect(run.calls.filter((call) => call.startsWith("wpctl set"))).toEqual([]);
    store.close();
  });
});

describe("Control Center's slider and the menu bar's speaker follow PipeWire", () => {
  const radio = { read: async () => null, set: async () => {} };

  test("Control Center: a change made with wpctl shows at once", async () => {
    const pw = monitor();
    const devices = new DeviceStore({
      run: quietRun(),
      wifiRadio: radio,
      bluetoothRadio: radio,
      hasBluetoothctl: false,
      hasBrightnessctl: false,
      followVolume: followOutputVolume(pw.watch),
    });
    const stop = devices.start();
    pw.print([defaults("mixer-speakers"), speakers(), mic]);
    await settle();
    expect(devices.getSnapshot().volume).toEqual({ level: 0.4, muted: false });
    pw.print([speakers([0.027, 0.027], true)]);
    await settle();
    expect(devices.getSnapshot().volume).toEqual({ level: 0.3, muted: true });
    stop();
    expect(pw.stops).toBe(1);
  });

  test("the menu bar: the speaker follows without a volume poll", async () => {
    const pw = monitor();
    let reads = 0;
    const store = new SystemStore(
      {
        battery: async () => null,
        network: async () => null,
        volume: async () => {
          reads++;
          return null;
        },
        followVolume: followOutputVolume(pw.watch),
      },
      () => () => {},
      () => () => {},
    );
    store.start();
    pw.print([defaults("mixer-speakers"), speakers(), mic]);
    await settle();
    expect(store.getSnapshot().volume).toEqual({ level: 0.4, muted: false });
    pw.print([speakers([0.064, 0.064], true)]);
    await settle();
    expect(store.getSnapshot().volume).toEqual({ level: 0.4, muted: true });
    expect(reads).toBe(1);
    store.stop();
    expect(pw.stops).toBe(1);
  });
});
