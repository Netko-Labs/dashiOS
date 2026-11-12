/**
 * The apps' sound as one store for the session: Control Center's Sound
 * page, Settings › Sound, the menu bar's microphone indicator and agents all
 * read it, so a change made in one is seen in the others. It follows
 * PipeWire as watch.ts reports it, groups streams into rows (rows.ts),
 * newest first, and keeps a row 5 s after its app's last stream went, so
 * it doesn't flicker between tracks.
 *
 * A change shows at once. One made to an app is made on each of its streams
 * (commands.ts); one made to a stream, on it alone. While a slider moves,
 * the newer level replaces the one waiting, so one write runs at a time per
 * row. What was set is shown until PipeWire has had a moment to report it,
 * so the slider doesn't jump back. Each app's volume, mute, output and
 * input are remembered by WirePlumber (commands.ts says how), not here.
 */

import { clampLevel, type MixerControl, type MoveTarget } from "./lib/commands.ts";
import { type Held, type HeldChange, Holds } from "./lib/holds.ts";
import { Lanes } from "./lib/lanes.ts";
import type { AppRecording, AppSound, Owner } from "./rows.ts";
import { rowsFrom } from "./rows.ts";
import type { Graph, MixerOutput } from "./streams.ts";
import { EMPTY_GRAPH, type GraphWatch } from "./watch.ts";

export interface MixerState {
  /** PipeWire can be watched here. */
  available: boolean;
  /** Most recently started first. */
  apps: AppSound[];
  recording: AppRecording[];
  /** The outputs an app can be sent to. */
  outputs: MixerOutput[];
  /** The inputs an app can record from. */
  inputs: MixerOutput[];
}

/** How long a row stays after its app's last stream went. */
export const LINGER_MS = 5000;
/** How long a change made here is shown over what PipeWire says, once it is made. */
export const HOLD_MS = 1500;

export interface AppMixerOptions {
  graph: GraphWatch;
  control: MixerControl;
  /** Who each stream belongs to (owners.ts); null hides it. */
  owner: Owner;
  now?: () => number;
  lingerMs?: number;
  holdMs?: number;
}

/** Which rows a change is for: the apps playing, or the apps recording. */
type Side = "play" | "record";

const appHold = (side: Side, key: string): string => `${side}:${key}`;
const streamHold = (id: number): string => `stream:${id}`;

export class AppMixer {
  private snapshot: MixerState;
  private readonly listeners = new Set<() => void>();
  private graph: Graph = EMPTY_GRAPH;
  /** When each app was first seen, for the order. */
  private readonly seen = new Map<string, number>();
  private live: AppSound[] = [];
  private liveRecording: AppRecording[] = [];
  private readonly lingering = new Map<string, { row: AppSound; until: number }>();
  private readonly holds: Holds;
  private readonly lanes = new Lanes();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopWatch: (() => void) | null = null;
  private readonly now: () => number;

  constructor(private readonly options: AppMixerOptions) {
    this.now = options.now ?? Date.now;
    this.holds = new Holds(this.now, options.control.held ? Number.POSITIVE_INFINITY : (options.holdMs ?? HOLD_MS));
    this.snapshot = { available: options.graph.available, apps: [], recording: [], outputs: [], inputs: [] };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MixerState => this.snapshot;

  start(): void {
    this.stopWatch ??= this.options.graph.start((graph) => {
      this.graph = graph;
      this.update();
    });
  }

  stop(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    clearTimeout(this.timer);
  }

  /** Who a stream belongs to changed (a window appeared): rows are made again. */
  refresh(): void {
    this.update();
  }

  /** Sets the app's level (0 to 1, capped at 100%) on each of its streams; raising a muted app unmutes it. */
  setLevel(key: string, level: number): Promise<boolean> {
    return this.level("play", key, level);
  }

  setMuted(key: string, muted: boolean): Promise<boolean> {
    return this.muted("play", key, muted);
  }

  /** Sends the app to an output (its node.name), or back to the default with null. */
  setOutput(key: string, output: string | null): Promise<boolean> {
    return this.target("play", key, output);
  }

  /** How much of its input a recording app takes, on each of its recording streams. */
  setRecordingLevel(key: string, level: number): Promise<boolean> {
    return this.level("record", key, level);
  }

  setRecordingMuted(key: string, muted: boolean): Promise<boolean> {
    return this.muted("record", key, muted);
  }

  /** Has the app record from an input (its node.name), or from the default with null. */
  setInput(key: string, input: string | null): Promise<boolean> {
    return this.target("record", key, input);
  }

  /** One stream's level alone; raising a muted stream unmutes it. */
  setStreamLevel(id: number, level: number): Promise<boolean> {
    const part = this.part(id);
    if (!part) return Promise.resolve(false);
    const value = clampLevel(level);
    const unmute = part.muted && value > 0;
    return this.write(streamHold(id), "level", { level: value, ...(unmute ? { muted: false } : {}) }, async () => {
      const set = await this.options.control.setLevel([id], value);
      return unmute ? (await this.options.control.setMuted([id], false)) && set : set;
    });
  }

  setStreamMuted(id: number, muted: boolean): Promise<boolean> {
    if (!this.part(id)) return Promise.resolve(false);
    return this.write(streamHold(id), "mute", { muted }, () => this.options.control.setMuted([id], muted));
  }

  private level(side: Side, key: string, level: number): Promise<boolean> {
    const row = this.row(side, key);
    if (!row) return Promise.resolve(false);
    const value = clampLevel(level);
    const unmute = row.muted && value > 0;
    this.dropParts(row);
    return this.write(appHold(side, key), "level", { level: value, ...(unmute ? { muted: false } : {}) }, async () => {
      const ids = this.idsOf(side, key);
      const set = await this.options.control.setLevel(ids, value);
      return unmute ? (await this.options.control.setMuted(ids, false)) && set : set;
    });
  }

  private muted(side: Side, key: string, muted: boolean): Promise<boolean> {
    const row = this.row(side, key);
    if (!row) return Promise.resolve(false);
    this.dropParts(row);
    return this.write(appHold(side, key), "mute", { muted }, () => this.options.control.setMuted(this.idsOf(side, key), muted));
  }

  private target(side: Side, key: string, name: string | null): Promise<boolean> {
    if (!this.row(side, key)) return Promise.resolve(false);
    let target: MoveTarget | null = null;
    if (name !== null) {
      const device = (side === "play" ? this.snapshot.outputs : this.snapshot.inputs).find((each) => each.name === name);
      if (!device) return Promise.resolve(false);
      target = { serial: device.serial, name: device.name };
    }
    return this.write(appHold(side, key), "target", { target: name }, () => this.options.control.setTarget(this.idsOf(side, key), target));
  }

  private row(side: Side, key: string): AppSound | AppRecording | undefined {
    return (side === "play" ? this.snapshot.apps : this.snapshot.recording).find((app) => app.key === key);
  }

  private part(id: number): { muted: boolean } | undefined {
    return [...this.snapshot.apps, ...this.snapshot.recording].flatMap((app) => app.parts).find((part) => part.id === id);
  }

  /** The app's streams now (one may have come since the change was asked for). */
  private idsOf(side: Side, key: string): number[] {
    return (side === "play" ? this.live : this.liveRecording).find((app) => app.key === key)?.streams ?? [];
  }

  /** A change to the whole app replaces what was set on its streams one by one. */
  private dropParts(row: AppSound | AppRecording): void {
    for (const part of row.parts) this.holds.drop(streamHold(part.id));
  }

  /** Shows the change at once and makes it; what was set shows a moment longer once the writes are done (for good on a development run). */
  private write(hold: string, lane: string, change: HeldChange, work: () => Promise<boolean>): Promise<boolean> {
    this.holds.set(hold, change);
    this.update();
    return this.lanes.run(hold, lane, work, () => {
      if (this.lanes.busy(hold)) return;
      this.holds.release(hold);
      this.update();
    });
  }

  private update(): void {
    const now = this.now();
    const { apps, recording } = rowsFrom(this.graph.streams, this.options.owner);
    const liveKeys = new Set(apps.map((app) => app.key));
    for (const app of apps) if (!this.seen.has(app.key)) this.seen.set(app.key, now);
    // An app whose streams all went stays a moment, paused, with nothing to open.
    for (const app of this.live) {
      if (!liveKeys.has(app.key) && !this.lingering.has(app.key)) {
        this.lingering.set(app.key, { row: { ...app, streams: [], parts: [], playing: false }, until: now + (this.options.lingerMs ?? LINGER_MS) });
      }
    }
    for (const key of liveKeys) this.lingering.delete(key);
    for (const [key, { until }] of this.lingering) if (until <= now) this.lingering.delete(key);
    for (const key of this.seen.keys()) if (!liveKeys.has(key) && !this.lingering.has(key)) this.seen.delete(key);
    this.live = apps;
    this.liveRecording = recording;

    const shown = [...apps, ...[...this.lingering.values()].map((each) => each.row)]
      .map((app) => this.withHeld("play", app))
      .sort((a, b) => (this.seen.get(b.key) ?? 0) - (this.seen.get(a.key) ?? 0) || a.name.localeCompare(b.name));
    const recorders = recording.map((app) => this.withHeld("record", app));
    this.holds.keep(now, [
      ...shown.map((app) => appHold("play", app.key)),
      ...recorders.map((app) => appHold("record", app.key)),
      ...[...shown, ...recorders].flatMap((app) => app.parts.map((part) => streamHold(part.id))),
    ]);
    this.publish({ available: this.options.graph.available, apps: shown, recording: recorders, outputs: this.graph.outputs, inputs: this.graph.inputs });
    this.schedule(now);
  }

  /** The row with what was set here laid over PipeWire's word: the app's change on every part, then each part's own. */
  private withHeld<T extends AppSound | AppRecording>(side: Side, app: T): T {
    const held = this.holds.get(appHold(side, app.key));
    const over = (row: { level: number; muted: boolean }, change: Held | undefined) => ({
      level: change?.level ?? row.level,
      muted: change?.muted ?? row.muted,
    });
    const parts = app.parts.map((part) => ({ ...part, ...over(over(part, held), this.holds.get(streamHold(part.id))) }));
    if (!held && parts.every((part, at) => part.level === app.parts[at]?.level && part.muted === app.parts[at]?.muted)) return app;
    // With parts, the row reads as they do (the loudest; muted when all are); a row that lingers has none.
    const whole = parts.length > 0 ? { level: Math.max(...parts.map((part) => part.level)), muted: parts.every((part) => part.muted) } : over(app, held);
    return { ...app, parts, ...whole, ...(held?.target !== undefined ? { target: held.target } : {}) };
  }

  /** Wakes at the next row or change to let go of. */
  private schedule(now: number): void {
    clearTimeout(this.timer);
    const times = [...[...this.lingering.values()].map((each) => each.until), ...this.holds.ends()].filter(Number.isFinite);
    if (times.length === 0) return;
    this.timer = setTimeout(() => this.update(), Math.max(Math.min(...times) - now, 0) + 1);
  }

  private publish(next: MixerState): void {
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
