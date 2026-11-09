/**
 * One long-lived `pw-dump --monitor` for the session: PipeWire's objects,
 * kept current as it reports changes (graph-map.ts), and handed on as a
 * parsed graph (streams.ts) a moment after each burst of changes. It sends
 * only changes, and nothing per audio tick. If it exits (PipeWire
 * restarted), it starts again after 1, 2, then 5 seconds, and until it is
 * back the graph is empty. pw-dump is PipeWire's own (MIT), run as a
 * separate program. Without it there is nothing to watch: `available` is
 * false.
 */

import { type WatchOptions, watchLines } from "../../system/watch.ts";
import { GraphMap, JsonArrays } from "./graph-map.ts";
import { type Graph, parseGraph } from "./streams.ts";

/** A burst of updates (a stream starting links several ports) is told once. */
const SETTLE_MS = 40;

export const EMPTY_GRAPH: Graph = { streams: [], outputs: [], defaultOutput: null };

export type Follow = (onLine: (line: string) => void, onStart: () => void) => () => void;

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

export function pipewireGraph(options: { follow?: Follow; available?: boolean } = {}): GraphWatch {
  const available = options.available ?? Bun.which("pw-dump") !== null;
  const follow = options.follow ?? followPipeWire();
  return {
    available,
    start(onGraph) {
      if (!available) return () => {};
      const arrays = new JsonArrays();
      const map = new GraphMap();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tell = () => {
        clearTimeout(timer);
        timer = setTimeout(() => onGraph(parseGraph(map.values())), SETTLE_MS);
      };
      const stop = follow(
        (line) => {
          let changed = false;
          for (const array of arrays.push(line)) changed = map.apply(array) || changed;
          if (changed) tell();
        },
        () => {
          // A new pw-dump starts with a whole dump: what the last one said is gone.
          arrays.reset();
          map.clear();
          tell();
        },
      );
      return () => {
        clearTimeout(timer);
        stop();
      };
    },
  };
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
