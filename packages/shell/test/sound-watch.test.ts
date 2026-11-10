/**
 * The outputs, the levels, Control Center's slider and the menu bar's speaker
 * following the session's one `pw-dump --monitor` (sound/apps/watch.ts)
 * instead of polling: pw-dump's own text in, as the monitor prints it (an
 * indented whole dump, then arrays of the objects that changed, `"info":
 * null` for one that went).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DeviceStore } from "../src/control-center/devices.ts";
import { type Follow, pipewireWatch } from "../src/sound/apps/watch.ts";
import { pipewireBackend, shadowBackend } from "../src/sound/backend.ts";
import { followOutputVolume, shadowLevels, wpctlLevels } from "../src/sound/levels.ts";
import { LevelsStore } from "../src/sound/levels-store.ts";
import { defaultVolume, devicesFrom, parseDump } from "../src/sound/parse-dump.ts";
import { SoundStore } from "../src/sound/store.ts";
import type { Run } from "../src/system/exec.ts";
import { SystemStore } from "../src/system/store.ts";
import { VolumeFollow } from "../src/system/volume-follow.ts";
import { metadata, node, vmGraph } from "./fixtures/pw-graph.ts";
import { fakeClockEachTest } from "./support/time.ts";

type Json = Record<string, unknown>;
const clock = fakeClockEachTest();
const settle = () => clock.advance(70); // longer than the watcher's 40 ms settle

/** A pw-dump --monitor that prints what the test gives it, as it prints it (indented, line by line). */
function monitor() {
  let lines: ((line: string) => void) | null = null;
  let starts = 0;
  let stops = 0;
  const follow: Follow = (onLine, onStart) => {
    starts++;
    lines = onLine;
    onStart();
    return () => {
      stops++;
      lines = null;
    };
  };
  /** What `pw-dump <id>` prints now, by id: a metadata object read again whole. */
  const objects = new Map<number, Json>();
  const reads: number[] = [];
  return {
    watch: pipewireWatch({
      follow,
      available: true,
      readObject: async (id) => {
        reads.push(id);
        const object = objects.get(id);
        return object ? JSON.stringify([object], null, 2) : null;
      },
    }),
    /** Sets what reading an object whole gives. */
    truth(object: Json): void {
      objects.set(object.id as number, object);
    },
    reads,
    print(objects: readonly Json[]): void {
      this.text(JSON.stringify(objects, null, 2));
    },
    text(text: string): void {
      for (const line of text.split("\n")) lines?.(line);
    },
    get starts() {
      return starts;
    },
    get stops() {
      return stops;
    },
  };
}

/** A run that answers nothing, and remembers what it was asked. */
function quietRun(): Run & { calls: string[] } {
  const calls: string[] = [];
  const run = async (command: readonly string[]) => {
    calls.push(command.join(" "));
    return null;
  };
  return Object.assign(run, { calls });
}

const defaults = (sink: string, source = "mixer-mic"): Json =>
  metadata(33, [
    { subject: 0, key: "default.audio.sink", type: "Spa:String:JSON", value: { name: sink } },
    { subject: 0, key: "default.audio.source", type: "Spa:String:JSON", value: { name: source } },
  ]);

const speakers = (volumes: number[] = [0.064, 0.064], mute = false): Json =>
  node(51, { "media.class": "Audio/Sink", "node.name": "mixer-speakers", "node.description": "Speakers" }, { volumes, mute, state: "idle" });
const headphones = (volumes: number[] = [0.216, 0.216]): Json =>
  node(56, { "media.class": "Audio/Sink", "node.name": "mixer-headphones", "node.description": "Headphones", "device.form-factor": "headphones" }, { volumes });
const mic = node(62, { "media.class": "Audio/Source/Virtual", "node.name": "mixer-mic", "node.description": "Microphone" }, { volumes: [0.125] });

describe("the watcher", () => {
  test("one pw-dump for every listener; it stops after the last", async () => {
    const pw = monitor();
    const heard: number[] = [];
    const stopA = pw.watch.subscribe((objects) => heard.push(objects.length));
    const stopB = pw.watch.subscribe(() => {});
    expect(pw.starts).toBe(1);
    pw.print(vmGraph());
    await settle();
    expect(heard).toEqual([vmGraph().length]);
    // A late listener hears what is there now.
    const late: number[] = [];
    const stopC = pw.watch.subscribe((objects) => late.push(objects.length));
    await settle();
    expect(late).toEqual([vmGraph().length]);
    stopA();
    stopB();
    expect(pw.stops).toBe(0);
    stopC();
    expect(pw.stops).toBe(1);
    // Listening again starts a new pw-dump, with nothing left from the last.
    const again: number[] = [];
    const stopD = pw.watch.subscribe((objects) => again.push(objects.length));
    expect(pw.starts).toBe(2);
    await settle();
    expect(again).toEqual([0]);
    stopD();
  });

  test("without pw-dump nothing runs", () => {
    let started = false;
    const watch = pipewireWatch({
      available: false,
      follow: () => {
        started = true;
        return () => {};
      },
    });
    watch.subscribe(() => {})();
    expect(started).toBe(false);
  });
});

describe("metadata, as the monitor prints it", () => {
  // `wpctl set-default 56`: the monitor prints the default metadata twice, each time with only the entry that changed.
  const only = (key: string, name: string): Json => metadata(33, [{ subject: 0, key, type: "Spa:String:JSON", value: { name } }]);

  test("an update lists only what changed: the rest is kept", async () => {
    const pw = monitor();
    const lists: string[][] = [];
    const stop = pipewireBackend(quietRun(), pw.watch).follow?.((list) => lists.push(list.map((output) => `${output.label}${output.current ? " ✓" : ""}`)));
    pw.print([defaults("mixer-speakers"), speakers(), headphones(), mic]);
    await settle();
    pw.print([only("default.audio.sink", "mixer-headphones")]);
    pw.print([only("default.configured.audio.sink", "mixer-headphones")]);
    await settle();
    expect(lists.at(-1)).toEqual(["Speakers", "Headphones ✓"]);
    stop?.();
  });

  test("an entry taken away isn't printed: the object is read again whole", async () => {
    const pw = monitor();
    const levels: Array<number | null> = [];
    const stop = followOutputVolume(pw.watch)((volume) => levels.push(volume?.level ?? null));
    pw.print([defaults("mixer-speakers"), speakers(), headphones(), mic]);
    await settle();
    expect(levels.at(-1)).toBe(0.4);
    // The default sink's entry deleted: the monitor prints the metadata with no entries.
    pw.truth(metadata(33, [{ subject: 0, key: "default.audio.source", type: "Spa:String:JSON", value: { name: "mixer-mic" } }]));
    pw.print([metadata(33, [])]);
    await settle();
    expect(pw.reads).toEqual([33]);
    expect(levels.at(-1)).toBeNull();
    stop?.();
  });

  test("a read that started before a newer update is read again", async () => {
    let release: (text: string | null) => void = () => {};
    const reads: number[] = [];
    let lines: ((line: string) => void) | null = null;
    const watch = pipewireWatch({
      available: true,
      follow: (onLine, onStart) => {
        lines = onLine;
        onStart();
        return () => {};
      },
      readObject: (id) => {
        reads.push(id);
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const print = (objects: Json[]) => {
      for (const line of JSON.stringify(objects, null, 2).split("\n")) lines?.(line);
    };
    const names: Array<string | undefined> = [];
    const stop = watch.subscribe((objects) => names.push(devicesFrom(objects).find((output) => output.current)?.label));
    print([defaults("mixer-speakers"), speakers(), headphones()]);
    print([only("default.audio.sink", "mixer-headphones")]);
    expect(reads).toEqual([33]);
    // A newer update while the read runs: the old read's answer is dropped and the object read again.
    print([only("default.audio.sink", "mixer-speakers")]);
    release(JSON.stringify([defaults("mixer-headphones")]));
    await clock.advance(5);
    expect(reads).toEqual([33, 33]);
    release(JSON.stringify([defaults("mixer-speakers")]));
    await settle();
    expect(names.at(-1)).toBe("Speakers");
    stop();
  });
});

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

describe("VolumeFollow", () => {
  test("holds what was set against older words; then the newest word since", () => {
    let now = 0;
    const shown: Array<number | null> = [];
    const follow = new VolumeFollow(
      (volume) => shown.push(volume?.level ?? null),
      1000,
      () => now,
    );
    follow.heard({ level: 0.4, muted: false });
    follow.set({ level: 0.8, muted: false });
    follow.heard({ level: 0.6, muted: false });
    follow.heard({ level: 0.8, muted: false });
    now = 1001;
    follow.heard({ level: 0.3, muted: false });
    expect(shown).toEqual([0.4, 0.8, 0.3]);
    follow.stop();
  });

  test("nothing heard since the set: what was set stays", async () => {
    const shown: Array<number | null> = [];
    const follow = new VolumeFollow((volume) => shown.push(volume?.level ?? null), 10);
    follow.heard({ level: 0.4, muted: false });
    follow.set({ level: 0.8, muted: false });
    await clock.advance(30);
    expect(shown).toEqual([0.4]);
    follow.set({ level: 0.9, muted: false });
    follow.heard({ level: 0.5, muted: false });
    await clock.advance(30);
    expect(shown).toEqual([0.4, 0.5]);
  });
});

describe("a real dump (the VM, PipeWire 1.6.11)", () => {
  const text = readFileSync(new URL("./fixtures/pw-dump-vm.txt", import.meta.url), "utf8");

  test("the watcher's reading is the one-shot reading", () => {
    const objects: unknown[] = JSON.parse(text);
    expect(devicesFrom(objects, "output")).toEqual(parseDump(text, "output") ?? []);
    expect(devicesFrom(objects, "input")).toEqual(parseDump(text, "input") ?? []);
    expect(devicesFrom(objects).some((output) => output.current)).toBe(true);
    expect(defaultVolume(objects, "output")).toMatchObject({ muted: false });
  });

  test("printed by the monitor, it reaches a listener whole", async () => {
    const pw = monitor();
    const lists: string[][] = [];
    const stop = pipewireBackend(quietRun(), pw.watch).follow?.((list) => lists.push(list.map((output) => output.label)));
    pw.text(text);
    await settle();
    stop?.();
    expect(lists).toEqual([(parseDump(text) ?? []).map((output) => output.label)]);
  });
});
