/**
 * The mixer's meters (sound/meter.ts, sound/stream-meters.ts): what a meter's recorder is told, that it
 * runs only while something listens, that rows on one node share one, and the most that run at once.
 */

import { describe, expect, test } from "bun:test";
import { type LevelMeter, meterCommand, pipewireMeter } from "../src/sound/meter.ts";
import { METER_FALL, meterShown, streamMeters } from "../src/sound/stream-meters.ts";

/** Meters that only count: which nodes are listened to now, and each one's push. */
function counted() {
  const running = new Map<number, (level: number) => void>();
  const started: number[] = [];
  const meterFor = (serial: number): LevelMeter => ({
    start(onLevel) {
      started.push(serial);
      running.set(serial, onLevel);
      return () => running.delete(serial);
    },
  });
  return { running, started, meterFor };
}

describe("a meter's recorder", () => {
  test("the microphone's listens to the default input, as before", () => {
    expect(meterCommand()).toEqual(["pw-record", "--raw", "--rate", "8000", "--channels", "1", "--format", "s16", "--latency", "50ms", "-"]);
  });

  test("a node's is pointed at its serial, and never falls back to another node", () => {
    const command = meterCommand(1084);
    expect(command.slice(0, 4)).toEqual(["pw-record", "--target", "1084", "-P"]);
    expect(JSON.parse(command[4] ?? "")).toEqual({
      "node.name": "dashi-meter",
      // Without its target it ends: a meter for an app's sound can never end up on the microphone.
      "node.dont-fallback": true,
      "node.dont-reconnect": true,
      // Never an app's row, and nothing of it in WirePlumber's memory.
      "stream.monitor": true,
      "state.restore-props": false,
      "state.restore-target": false,
    });
    expect(command.at(-1)).toBe("-");
  });

  test("a serial that isn't one starts nothing", () => {
    const spawned: string[][] = [];
    const spawn = (command: string[]) => {
      spawned.push(command);
      return { stdout: new ReadableStream<Uint8Array>(), kill() {} };
    };
    for (const serial of [-1, 1.5, Number.NaN]) pipewireMeter(spawn, serial).start(() => {})();
    expect(spawned).toEqual([]);
    const stop = pipewireMeter(spawn, 1084).start(() => {});
    expect(spawned).toHaveLength(1);
    stop();
  });
});

describe("the meters", () => {
  test("no meter runs while nothing shows it; the first listener starts one, the last one's leaving stops it", () => {
    const { running, started, meterFor } = counted();
    const meters = streamMeters(meterFor);
    expect(running.size).toBe(0);
    const heard: number[] = [];
    const stop = meters.listen(1084, (level) => heard.push(level));
    expect([...running.keys()]).toEqual([1084]);
    running.get(1084)?.(0.5);
    expect(heard).toEqual([0.5]);
    stop();
    expect(running.size).toBe(0);
    // Stopping twice is harmless, and listening again starts a new one.
    stop();
    meters.listen(1084, () => {})();
    expect(started).toEqual([1084, 1084]);
  });

  test("two rows on one node (two apps on one microphone) share one recorder", () => {
    const { running, started, meterFor } = counted();
    const meters = streamMeters(meterFor);
    const first: number[] = [];
    const second: number[] = [];
    const stopFirst = meters.listen(1062, (level) => first.push(level));
    const stopSecond = meters.listen(1062, (level) => second.push(level));
    expect(started).toEqual([1062]);
    running.get(1062)?.(0.3);
    expect([first, second]).toEqual([[0.3], [0.3]]);
    stopFirst();
    expect(running.has(1062)).toBe(true);
    running.get(1062)?.(0.4);
    expect([first, second]).toEqual([[0.3], [0.3, 0.4]]);
    stopSecond();
    expect(running.size).toBe(0);
  });

  test("at most so many run at once; past that a row's meter stays empty", () => {
    const { running, meterFor } = counted();
    const meters = streamMeters(meterFor, 2);
    const stops = [meters.listen(1, () => {}), meters.listen(2, () => {}), meters.listen(3, () => {})];
    expect([...running.keys()]).toEqual([1, 2]);
    stops[0]?.();
    // Room again.
    meters.listen(3, () => {});
    expect([...running.keys()]).toEqual([2, 3]);
  });

  test("a bar rises at once and falls a step a reading", () => {
    expect(meterShown(0.8, 0.1)).toBe(0.8);
    expect(meterShown(0, 0.8)).toBeCloseTo(0.8 - METER_FALL, 5);
    expect(meterShown(0, 0.1)).toBe(0);
  });
});
