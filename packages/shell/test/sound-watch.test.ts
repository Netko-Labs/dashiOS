/**
 * The watcher: one pw-dump --monitor for every listener, metadata as the monitor prints it (only what
 * changed is listed, an entry taken away is read again whole), and a real dump printed by the monitor.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pipewireWatch } from "../src/sound/apps/index.ts";
import { pipewireBackend } from "../src/sound/backend.ts";
import { followOutputVolume } from "../src/sound/levels.ts";
import { defaultVolume, devicesFrom, parseDump } from "../src/sound/lib/parse-dump.ts";
import { metadata, vmGraph } from "./fixtures/pw-graph.ts";
import { defaults, headphones, type Json, mic, monitor, quietRun, speakers, watchSettle } from "./support/sound-watch.ts";
import { fakeClockEachTest } from "./support/time.ts";

const clock = fakeClockEachTest();
const settle = watchSettle(clock);

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
