/**
 * The apps' sound as one store for the session: Control Center's Sound
 * page, Settings › Sound, the menu bar's microphone indicator and agents all
 * read it, so a change made in one is seen in the others. It follows
 * PipeWire as watch.ts reports it, groups streams into rows (rows.ts),
 * newest first, and keeps a row 5 s after its app's last stream went, so
 * it doesn't flicker between tracks.
 *
 * A change shows at once and is made on each of the app's streams
 * (commands.ts); while a slider moves, the newer level replaces the one
 * waiting, so one write runs at a time per app. What was set is shown until
 * PipeWire has had a moment to report it, so the slider doesn't jump back.
 * Each app's volume and mute are remembered by WirePlumber (per
 * application.name), not here.
 */

import { useSyncExternalStore } from "react";
import { clampLevel, isNodeName, type MixerControl } from "./commands.ts";
import type { AppRecording, AppSound, Owner } from "./rows.ts";
import { micIndicator, rowsFrom } from "./rows.ts";
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

interface Held {
  level?: number;
  muted?: boolean;
  target?: string | null;
  /** Shown over the truth until then; Infinity while a write is running. */
  until: number;
}

interface Lane {
  running: boolean;
  next: (() => Promise<boolean>) | null;
  waiters: Array<(ok: boolean) => void>;
}

export class AppMixer {
  private snapshot: MixerState;
  private readonly listeners = new Set<() => void>();
  private graph: Graph = EMPTY_GRAPH;
  /** When each app was first seen, for the order. */
  private readonly seen = new Map<string, number>();
  private live: AppSound[] = [];
  private readonly lingering = new Map<string, { row: AppSound; until: number }>();
  private readonly held = new Map<string, Held>();
  private readonly lanes = new Map<string, Lane>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopWatch: (() => void) | null = null;
  private readonly now: () => number;

  constructor(private readonly options: AppMixerOptions) {
    this.now = options.now ?? Date.now;
    this.snapshot = { available: options.graph.available, apps: [], recording: [], outputs: [] };
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
    const row = this.row(key);
    if (!row) return Promise.resolve(false);
    const value = clampLevel(level);
    const unmute = row.muted && value > 0;
    this.hold(key, { level: value, ...(unmute ? { muted: false } : {}) });
    return this.enqueue(key, `${key}:level`, async () => {
      const ids = this.idsOf(key);
      const set = await this.options.control.setLevel(ids, value);
      return unmute ? (await this.options.control.setMuted(ids, false)) && set : set;
    });
  }

  setMuted(key: string, muted: boolean): Promise<boolean> {
    if (!this.row(key)) return Promise.resolve(false);
    this.hold(key, { muted });
    return this.enqueue(key, `${key}:mute`, () => this.options.control.setMuted(this.idsOf(key), muted));
  }

  /** Sends the app to an output (its node.name), or back to the default with null. */
  setOutput(key: string, output: string | null): Promise<boolean> {
    if (!this.row(key)) return Promise.resolve(false);
    if (output !== null && (!isNodeName(output) || !this.snapshot.outputs.some((each) => each.name === output))) return Promise.resolve(false);
    this.hold(key, { target: output });
    return this.enqueue(key, `${key}:output`, () => this.options.control.setOutput(this.idsOf(key), output));
  }

  private row(key: string): AppSound | undefined {
    return this.snapshot.apps.find((app) => app.key === key);
  }

  /** The app's streams now (one may have come since the change was asked for). */
  private idsOf(key: string): number[] {
    return this.live.find((app) => app.key === key)?.streams ?? [];
  }

  private hold(key: string, change: Omit<Held, "until">): void {
    this.held.set(key, { ...this.held.get(key), ...change, until: Number.POSITIVE_INFINITY });
    this.update();
  }

  /** One write at a time per app and kind; a newer one replaces the one waiting, and both callers hear how the newer went. */
  private enqueue(key: string, laneKey: string, work: () => Promise<boolean>): Promise<boolean> {
    const lane = this.lanes.get(laneKey) ?? { running: false, next: null, waiters: [] };
    this.lanes.set(laneKey, lane);
    return new Promise((resolve) => {
      lane.next = work;
      lane.waiters.push(resolve);
      if (lane.running) return;
      lane.running = true;
      void (async () => {
        while (lane.next) {
          const job = lane.next;
          const waiters = lane.waiters;
          lane.next = null;
          lane.waiters = [];
          let ok = false;
          try {
            ok = await job();
          } catch {
            ok = false;
          }
          for (const waiter of waiters) waiter(ok);
        }
        lane.running = false;
        this.release(key);
      })();
    });
  }

  /** The writes for `key` are done: what they set shows a moment longer (for good on a development run), then PipeWire's word. */
  private release(key: string): void {
    const held = this.held.get(key);
    if (!held || [...this.lanes.entries()].some(([lane, each]) => lane.startsWith(`${key}:`) && each.running)) return;
    held.until = this.options.control.held ? Number.POSITIVE_INFINITY : this.now() + (this.options.holdMs ?? HOLD_MS);
    this.update();
  }

  private update(): void {
    const now = this.now();
    const { apps, recording } = rowsFrom(this.graph.streams, this.options.owner);
    const liveKeys = new Set(apps.map((app) => app.key));
    for (const app of apps) if (!this.seen.has(app.key)) this.seen.set(app.key, now);
    // An app whose streams all went stays a moment, paused.
    for (const app of this.live) {
      if (!liveKeys.has(app.key) && !this.lingering.has(app.key)) {
        this.lingering.set(app.key, { row: { ...app, streams: [], playing: false }, until: now + (this.options.lingerMs ?? LINGER_MS) });
      }
    }
    for (const key of liveKeys) this.lingering.delete(key);
    for (const [key, { until }] of this.lingering) if (until <= now) this.lingering.delete(key);
    for (const [key, held] of this.held) if (held.until <= now) this.held.delete(key);
    for (const key of this.seen.keys()) if (!liveKeys.has(key) && !this.lingering.has(key)) this.seen.delete(key);
    this.live = apps;

    const shown = [...apps, ...[...this.lingering.values()].map((each) => each.row)]
      .map((app) => this.withHeld(app))
      .sort((a, b) => (this.seen.get(b.key) ?? 0) - (this.seen.get(a.key) ?? 0) || a.name.localeCompare(b.name));
    this.publish({ available: this.options.graph.available, apps: shown, recording, outputs: this.graph.outputs });
    this.schedule(now);
  }

  private withHeld(app: AppSound): AppSound {
    const held = this.held.get(app.key);
    if (!held) return app;
    return {
      ...app,
      ...(held.level !== undefined ? { level: held.level } : {}),
      ...(held.muted !== undefined ? { muted: held.muted } : {}),
      ...(held.target !== undefined ? { target: held.target } : {}),
    };
  }

  /** Wakes at the next row or change to let go of. */
  private schedule(now: number): void {
    clearTimeout(this.timer);
    const times = [...[...this.lingering.values()].map((each) => each.until), ...[...this.held.values()].map((each) => each.until)].filter(Number.isFinite);
    if (times.length === 0) return;
    this.timer = setTimeout(() => this.update(), Math.max(Math.min(...times) - now, 0) + 1);
  }

  private publish(next: MixerState): void {
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

const QUIET: MixerState = { available: false, apps: [], recording: [], outputs: [] };
const NEVER = () => () => {};

/** What the microphone indicator says ("" while no app records from a microphone): the menu bar redraws only when it changes. */
export function useMicWords(store: AppMixer | undefined): string {
  return useSyncExternalStore(store?.subscribe ?? NEVER, () => (store ? micIndicator(store.getSnapshot().recording).words : ""));
}

/** An app with a row: its key and its name. */
export interface AppName {
  key: string;
  name: string;
}

const NO_NAMES: readonly AppName[] = [];
const namesCache = new WeakMap<AppMixer, { text: string; names: readonly AppName[] }>();

/** The apps' keys and names, for Settings' search: a window redraws only when an app comes or goes, not as a level moves. */
export function useAppNames(store: AppMixer | undefined): readonly AppName[] {
  return useSyncExternalStore(store?.subscribe ?? NEVER, () => {
    if (!store) return NO_NAMES;
    const names = store.getSnapshot().apps.map(({ key, name }) => ({ key, name }));
    const text = JSON.stringify(names);
    const cached = namesCache.get(store);
    if (cached?.text === text) return cached.names;
    namesCache.set(store, { text, names });
    return names;
  });
}

/** The mixer's state; without a mixer, no apps. */
export function useMixer(store: AppMixer | undefined): MixerState {
  return useSyncExternalStore(store?.subscribe ?? NEVER, store?.getSnapshot ?? (() => QUIET));
}
