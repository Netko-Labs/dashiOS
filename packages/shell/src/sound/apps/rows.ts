/**
 * Streams as the rows people see: one row per app, however many streams it
 * has (a browser's tabs, a game's music and effects), and one per app that
 * records. Dashi's own streams (event sounds, Settings' level meter, the
 * screen recorder's) and PipeWire's inner ones are not rows. Pure: streams
 * and who each belongs to in, rows out.
 */

import type { AppIdentity } from "../../shared/processes/index.ts";
import type { MixerOutput, Stream } from "./streams.ts";

/** An app that plays sound. */
export interface AppSound {
  key: string;
  name: string;
  icon: string;
  /** Its streams' node ids: a change is made on each. */
  streams: number[];
  /** The loudest of its streams, 0 to 1. */
  level: number;
  /** Every stream of it is muted. */
  muted: boolean;
  /** Sound moves through one of its streams now; else it is paused. */
  playing: boolean;
  /** The output it plays on now (its label), null while it isn't linked. */
  output: string | null;
  /** The output chosen for it ("Play on"): a node.name, or null for the default. */
  target: string | null;
}

/** An app that records: from a microphone, or this computer's own sound. */
export interface AppRecording {
  key: string;
  name: string;
  icon: string;
  /** The input's label. */
  input: string;
  /** It records a sink's monitor (this computer's sound), not a microphone. */
  monitor: boolean;
}

export interface MixerRows {
  apps: AppSound[];
  recording: AppRecording[];
}

/** Who a stream belongs to; null hides it (Dashi's own). */
export type Owner = (stream: Stream) => AppIdentity | null;

/** Rows from streams, in the streams' order (the store sorts them). */
export function rowsFrom(streams: readonly Stream[], owner: Owner): MixerRows {
  const apps = new Map<string, AppSound>();
  const recording = new Map<string, AppRecording>();
  for (const stream of streams) {
    if (stream.internal) continue;
    const app = owner(stream);
    if (app === null) continue;
    if (stream.direction === "record") {
      // Recording is sound moving from an input into the app; a stream left linked but paused records nothing.
      if (!stream.running || stream.device === null || recording.has(app.key)) continue;
      recording.set(app.key, { key: app.key, name: app.name, icon: app.icon, input: stream.device.label, monitor: stream.device.kind === "monitor" });
      continue;
    }
    const row = apps.get(app.key);
    if (!row) {
      apps.set(app.key, {
        key: app.key,
        name: app.name,
        icon: app.icon,
        streams: [stream.id],
        level: stream.level,
        muted: stream.muted,
        playing: stream.running,
        output: stream.device?.label ?? null,
        target: stream.target,
      });
      continue;
    }
    row.streams.push(stream.id);
    row.level = Math.max(row.level, stream.level);
    row.muted = row.muted && stream.muted;
    if (stream.running && !row.playing) row.output = stream.device?.label ?? row.output;
    row.playing = row.playing || stream.running;
    row.output ??= stream.device?.label ?? null;
    row.target ??= stream.target;
  }
  return { apps: [...apps.values()], recording: [...recording.values()] };
}

/** The microphone indicator: on while an app records from a microphone, and what it says. */
export interface MicIndicator {
  on: boolean;
  names: string[];
  /** "Signal is using the microphone." */
  words: string;
}

export function micIndicator(recording: readonly AppRecording[]): MicIndicator {
  const names = recording.filter((each) => !each.monitor).map((each) => each.name);
  const unique = [...new Set(names)];
  if (unique.length === 0) return { on: false, names: [], words: "" };
  const [first, second] = unique;
  const who = unique.length === 1 ? first : unique.length === 2 ? `${first} and ${second}` : `${first} and ${unique.length - 1} more`;
  return { on: true, names: unique, words: `${who} ${unique.length === 1 ? "is" : "are"} using the microphone.` };
}

/** What "Play on" says: "Default", or the chosen output's label (its name when it is gone). */
export function playOnLabel(target: string | null, outputs: readonly MixerOutput[]): string {
  if (target === null) return "Default";
  return outputs.find((output) => output.name === target || String(output.id) === target)?.label ?? target;
}
