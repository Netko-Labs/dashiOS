/**
 * Streams as the rows people see: one row per app, however many streams it
 * has (a browser's tabs, a game's voice chat and its music), each stream a
 * part the row opens to show; and one row per app that records, its parts
 * the streams that record now. Dashi's own streams (event sounds, the level
 * meters, the screen recorder's) and PipeWire's inner ones are not rows.
 * Pure: streams and who each belongs to in, rows out.
 */

import type { AppIdentity } from "../../shared/processes/index.ts";
import type { MixerOutput, Stream } from "./streams.ts";

/** One stream of an app: what its row opens to show. */
export interface StreamSound {
  /** The node's id: a change to this stream alone is made on it. */
  id: number;
  /** What the app calls it (media.name), numbered when two share a name: "Playback", "Playback 2". */
  title: string;
  level: number;
  muted: boolean;
  /** Sound moves through it now. */
  playing: boolean;
  /** What its meter listens to (an object.serial): the stream itself when it plays, the device it records from when it records. */
  meter: number | null;
}

/** An app that plays sound. */
export interface AppSound {
  key: string;
  name: string;
  icon: string;
  /** Its streams' node ids: a change to the app is made on each. */
  streams: number[];
  /** Its streams, one by one. */
  parts: StreamSound[];
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
  /** Its recording streams' node ids. */
  streams: number[];
  parts: StreamSound[];
  /** How much of the input it takes (its streams' own volume, the loudest), 0 to 1. */
  level: number;
  muted: boolean;
  /** The input's label. */
  input: string;
  /** It records only a sink's monitor (this computer's sound), not a microphone. */
  monitor: boolean;
  /** The input chosen for it ("Record from"): a node.name, or null for the default. */
  target: string | null;
}

export interface MixerRows {
  apps: AppSound[];
  recording: AppRecording[];
}

/** Who a stream belongs to; null hides it (Dashi's own). */
export type Owner = (stream: Stream) => AppIdentity | null;

/** What a stream is called: its media.name; a file's path (what a player gives) as the file's name; "Sound" for one that names nothing. */
export function streamTitle(mediaName: string | null): string {
  const name = mediaName?.trim() ?? "";
  if (name === "") return "Sound";
  return name.startsWith("/") ? (name.split("/").filter(Boolean).at(-1) ?? name) : name;
}

function partOf(stream: Stream): StreamSound {
  const meter = stream.direction === "play" ? stream.serial : (stream.device?.serial ?? null);
  return { id: stream.id, title: streamTitle(stream.mediaName), level: stream.level, muted: stream.muted, playing: stream.running, meter };
}

/** Parts that share a title are numbered from the second: "Playback", "Playback 2". */
function numbered(parts: StreamSound[]): StreamSound[] {
  const seen = new Map<string, number>();
  return parts.map((part) => {
    const count = (seen.get(part.title) ?? 0) + 1;
    seen.set(part.title, count);
    return count === 1 ? part : { ...part, title: `${part.title} ${count}` };
  });
}

function addPlaying(apps: Map<string, AppSound>, app: AppIdentity, stream: Stream): void {
  const row = apps.get(app.key);
  if (!row) {
    apps.set(app.key, {
      key: app.key,
      name: app.name,
      icon: app.icon,
      streams: [stream.id],
      parts: [partOf(stream)],
      level: stream.level,
      muted: stream.muted,
      playing: stream.running,
      output: stream.device?.label ?? null,
      target: stream.target,
    });
    return;
  }
  row.streams.push(stream.id);
  row.parts.push(partOf(stream));
  row.level = Math.max(row.level, stream.level);
  row.muted = row.muted && stream.muted;
  if (stream.running && !row.playing) row.output = stream.device?.label ?? row.output;
  row.playing = row.playing || stream.running;
  row.output ??= stream.device?.label ?? null;
  row.target ??= stream.target;
}

function addRecording(recording: Map<string, AppRecording>, app: AppIdentity, stream: Stream): void {
  // Recording is sound moving from an input into the app; a stream left linked but paused records nothing.
  if (!stream.running || stream.device === null) return;
  const monitor = stream.device.kind === "monitor";
  const row = recording.get(app.key);
  if (!row) {
    recording.set(app.key, {
      key: app.key,
      name: app.name,
      icon: app.icon,
      streams: [stream.id],
      parts: [partOf(stream)],
      level: stream.level,
      muted: stream.muted,
      input: stream.device.label,
      monitor,
      target: stream.target,
    });
    return;
  }
  row.streams.push(stream.id);
  row.parts.push(partOf(stream));
  row.level = Math.max(row.level, stream.level);
  row.muted = row.muted && stream.muted;
  // A microphone is what the row names, whatever else the app records.
  if (row.monitor && !monitor) row.input = stream.device.label;
  row.monitor = row.monitor && monitor;
  row.target ??= stream.target;
}

/** Rows from streams, in the streams' order (the store sorts them). */
export function rowsFrom(streams: readonly Stream[], owner: Owner): MixerRows {
  const apps = new Map<string, AppSound>();
  const recording = new Map<string, AppRecording>();
  for (const stream of streams) {
    if (stream.internal) continue;
    const app = owner(stream);
    if (app === null) continue;
    if (stream.direction === "record") addRecording(recording, app, stream);
    else addPlaying(apps, app, stream);
  }
  const withTitles = <T extends { parts: StreamSound[] }>(row: T): T => ({ ...row, parts: numbered(row.parts) });
  return { apps: [...apps.values()].map(withTitles), recording: [...recording.values()].map(withTitles) };
}

/** The microphone indicator: on while an app records from a microphone, and what it says. */
export interface MicIndicator {
  on: boolean;
  names: string[];
  /** "Signal is using the microphone." */
  words: string;
}

export function micIndicator(recording: readonly Pick<AppRecording, "name" | "monitor">[]): MicIndicator {
  const names = recording.filter((each) => !each.monitor).map((each) => each.name);
  const unique = [...new Set(names)];
  if (unique.length === 0) return { on: false, names: [], words: "" };
  const [first, second] = unique;
  const who = unique.length === 1 ? first : unique.length === 2 ? `${first} and ${second}` : `${first} and ${unique.length - 1} more`;
  return { on: true, names: unique, words: `${who} ${unique.length === 1 ? "is" : "are"} using the microphone.` };
}

/** What "Play on" and "Record from" say: "Default", or the chosen device's label (its name when it is gone). */
export function playOnLabel(target: string | null, devices: readonly MixerOutput[]): string {
  if (target === null) return "Default";
  return devices.find((device) => device.name === target)?.label ?? target;
}
