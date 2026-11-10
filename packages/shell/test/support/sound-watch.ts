/**
 * Shared set-up for the sound watcher tests: a pw-dump --monitor the test prints into, a run that
 * answers nothing, the speakers, headphones and microphone as the monitor prints them, and the settle.
 */

import { type Follow, pipewireWatch } from "../../src/sound/apps/index.ts";
import type { Run } from "../../src/system/exec.ts";
import { metadata, node } from "../fixtures/pw-graph.ts";
import type { FakeClock } from "./time.ts";

export type Json = Record<string, unknown>;

/** What the fake monitor gives the watcher, and what the test does to it. */
export type Monitor = {
  watch: ReturnType<typeof pipewireWatch>;
  truth(object: Json): void;
  reads: number[];
  print(objects: readonly Json[]): void;
  text(text: string): void;
  readonly starts: number;
  readonly stops: number;
};

/** A pw-dump --monitor that prints what the test gives it, as it prints it (indented, line by line). */
export function monitor(): Monitor {
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
export function quietRun(): Run & { calls: string[] } {
  const calls: string[] = [];
  const run = async (command: readonly string[]) => {
    calls.push(command.join(" "));
    return null;
  };
  return Object.assign(run, { calls });
}

export const defaults = (sink: string, source = "mixer-mic"): Json =>
  metadata(33, [
    { subject: 0, key: "default.audio.sink", type: "Spa:String:JSON", value: { name: sink } },
    { subject: 0, key: "default.audio.source", type: "Spa:String:JSON", value: { name: source } },
  ]);

export const speakers = (volumes: number[] = [0.064, 0.064], mute = false): Json =>
  node(51, { "media.class": "Audio/Sink", "node.name": "mixer-speakers", "node.description": "Speakers" }, { volumes, mute, state: "idle" });
export const headphones = (volumes: number[] = [0.216, 0.216]): Json =>
  node(56, { "media.class": "Audio/Sink", "node.name": "mixer-headphones", "node.description": "Headphones", "device.form-factor": "headphones" }, { volumes });
export const mic = node(62, { "media.class": "Audio/Source/Virtual", "node.name": "mixer-mic", "node.description": "Microphone" }, { volumes: [0.125] });

/** The watcher's settle on the test's fake clock: longer than its 40 ms. */
export function watchSettle(clock: FakeClock): () => Promise<void> {
  return () => clock.advance(70);
}
