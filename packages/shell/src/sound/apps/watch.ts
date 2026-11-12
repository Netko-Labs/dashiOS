/**
 * One long-lived `pw-dump --monitor` for the session: PipeWire's objects,
 * kept current as it reports changes (graph-map.ts), and handed to everyone
 * who listens a moment after each burst of changes: the mixer (as a parsed
 * graph, streams.ts), the outputs and inputs (sound/store.ts), the levels
 * (sound/levels-store.ts), Control Center's slider and the menu bar's
 * speaker. It sends only changes, and nothing per audio tick, so nothing
 * polls. It runs while anyone listens. If it exits (PipeWire restarted), it
 * starts again after 1, 2, then 5 seconds, and until it is back there are
 * no objects. pw-dump is PipeWire's own (MIT), run as a separate program,
 * and only reads. Without it there is nothing to watch: `available` is false.
 *
 * The monitor doesn't say which metadata entry was taken away (Play on ›
 * Default deletes `target.object`): after a metadata update that object is
 * read again whole with a one-off `pw-dump <id>` (graph-map.ts).
 */

import { run as defaultRun } from "../../system/exec.ts";
import { type WatchOptions, watchLines } from "../../system/watch.ts";
import { GraphMap, JsonArrays } from "./lib/graph-map.ts";
import { type Graph, parseGraph } from "./streams.ts";

/** A burst of updates (a stream starting links several ports) is told once. */
const SETTLE_MS = 40;

export const EMPTY_GRAPH: Graph = { streams: [], outputs: [], defaultOutput: null };

export type Follow = (onLine: (line: string) => void, onStart: () => void) => () => void;

export type PipeWireObjects = readonly Record<string, unknown>[];

/** PipeWire's objects, shared by everyone who follows them. */
export interface PipeWireWatch {
  /** Whether PipeWire can be watched here. */
  readonly available: boolean;
  /** `onObjects` hears every object after each change (and the current ones soon after it subscribes, if there are any yet). Returns the stop. */
  subscribe(onObjects: (objects: PipeWireObjects) => void): () => void;
}

export interface GraphWatch {
  /** Whether PipeWire can be watched here. */
  readonly available: boolean;
  /** Starts watching; `onGraph` hears the whole graph after each change. Returns the stop function. */
  start(onGraph: (graph: Graph) => void): () => void;
}

const followPipeWire =
  (options: Pick<WatchOptions, "which" | "spawn"> = {}): Follow =>
  (onLine, onStart) =>
    watchLines(["pw-dump", "--monitor", "--no-colors"], onLine, { restartMs: 1000, maxDelayMs: 5000, healthyMs: 10_000, onStart, ...options });

/** Reads one object whole (`pw-dump <id>`): its text, or null. */
export type ReadObject = (id: number) => Promise<string | null>;

const readPipeWireObject: ReadObject = (id) => defaultRun(["pw-dump", "--no-colors", String(id)]);

export interface PipeWireWatchOptions {
  follow?: Follow;
  available?: boolean;
  /** Reads a metadata object again whole after an update. */
  readObject?: ReadObject;
}

/** The session's one watcher: pw-dump runs from the first listener to the last one's stop. */
export function pipewireWatch(options: PipeWireWatchOptions = {}): PipeWireWatch {
  const available = options.available ?? Bun.which("pw-dump") !== null;
  const follow = options.follow ?? followPipeWire();
  const readObject = options.readObject ?? readPipeWireObject;
  /** Each metadata object's updates, counted: a read that started before the latest is read again. */
  const updates = new Map<number, number>();
  const reading = new Set<number>();
  /** Counts pw-dump's starts: a read from before a restart is dropped. */
  let generation = 0;
  const listeners = new Set<(objects: PipeWireObjects) => void>();
  const arrays = new JsonArrays();
  const map = new GraphMap();
  /** The objects as last told; null until the first dump settles. */
  let told: PipeWireObjects | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopFollow: (() => void) | null = null;

  const tell = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const objects = map.values();
      told = objects;
      for (const listener of [...listeners]) listener(objects);
    }, SETTLE_MS);
  };
  const reread = (id: number): void => {
    if (reading.has(id)) return;
    reading.add(id);
    const seen = updates.get(id) ?? 0;
    const started = generation;
    void readObject(id)
      .catch(() => null)
      .then((text) => {
        reading.delete(id);
        if (started !== generation || stopFollow === null) return;
        // An update came while reading: what was read may be older than it.
        if ((updates.get(id) ?? 0) !== seen) {
          reread(id);
          return;
        }
        if (text !== null && map.apply(text, { whole: true })) tell();
      });
  };
  const begin = () => {
    stopFollow = follow(
      (line) => {
        let changed = false;
        for (const array of arrays.push(line)) changed = map.apply(array) || changed;
        for (const id of map.takeMetadata()) {
          updates.set(id, (updates.get(id) ?? 0) + 1);
          reread(id);
        }
        if (changed) tell();
      },
      () => {
        // A new pw-dump starts with a whole dump: what the last one said is gone.
        generation++;
        arrays.reset();
        map.clear();
        tell();
      },
    );
  };
  const end = () => {
    generation++;
    clearTimeout(timer);
    stopFollow?.();
    stopFollow = null;
    arrays.reset();
    map.clear();
    told = null;
  };

  return {
    available,
    subscribe(onObjects) {
      if (!available) return () => {};
      // Each subscription is its own entry, so the same function may listen twice.
      const listener = (objects: PipeWireObjects) => onObjects(objects);
      listeners.add(listener);
      if (stopFollow === null) begin();
      let first: ReturnType<typeof setTimeout> | undefined;
      if (told !== null) {
        const now = told;
        first = setTimeout(() => {
          if (listeners.has(listener) && told === now) listener(now);
        }, 0);
      }
      return () => {
        clearTimeout(first);
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) end();
      };
    },
  };
}

/** The mixer's view of the watcher: the objects parsed as streams and outputs. */
export function graphOf(watch: PipeWireWatch): GraphWatch {
  return {
    available: watch.available,
    start: (onGraph) => watch.subscribe((objects) => onGraph(parseGraph(objects))),
  };
}

/** A watcher of its own, as a graph (tests; the session shares one through `graphOf`). */
export function pipewireGraph(options: PipeWireWatchOptions = {}): GraphWatch {
  return graphOf(pipewireWatch(options));
}

/** A graph that never changes: for a test, or a run with sound off. */
export function fixedGraph(graph: Graph): GraphWatch {
  return {
    available: true,
    start(onGraph) {
      const timer = setTimeout(() => onGraph(graph), 0);
      return () => clearTimeout(timer);
    },
  };
}
