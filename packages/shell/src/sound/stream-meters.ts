/**
 * The mixer's meters: a live level for each app and, when its row is open,
 * for each of its streams (meter.ts says how one listens). A meter runs
 * only while something on screen listens to it: the first listener of a
 * node starts its recorder, the last one's leaving stops it, and two rows
 * that show the same node (two apps on one microphone) share one. At most
 * `METERS_MAX` run at once; past that a row's meter stays empty.
 */

import { useEffect, useRef, useState } from "react";
import type { LevelMeter } from "./meter.ts";

/** How many recorders may run at once. */
export const METERS_MAX = 16;

export interface StreamMeters {
  /** Hears the level (0 to 1, about ten times a second) of the node whose object.serial is `serial`. Returns the stop. */
  listen(serial: number, onLevel: (level: number) => void): () => void;
}

interface Tap {
  stop: () => void;
  listeners: Set<{ onLevel: (level: number) => void }>;
}

export function streamMeters(meterFor: (serial: number) => LevelMeter, max: number = METERS_MAX): StreamMeters {
  const taps = new Map<number, Tap>();
  return {
    listen(serial, onLevel) {
      let tap = taps.get(serial);
      if (!tap) {
        if (taps.size >= max) return () => {};
        const listeners: Tap["listeners"] = new Set();
        const stop = meterFor(serial).start((level) => {
          for (const each of [...listeners]) each.onLevel(level);
        });
        tap = { stop, listeners };
        taps.set(serial, tap);
      }
      const listener = { onLevel };
      const mine = tap;
      mine.listeners.add(listener);
      return () => {
        if (!mine.listeners.delete(listener) || mine.listeners.size > 0) return;
        mine.stop();
        if (taps.get(serial) === mine) taps.delete(serial);
      };
    },
  };
}

/** How fast a bar falls: a meter reads the loudest sample of each 100 ms, which would flicker as a bar. */
export const METER_FALL = 0.25;

/** A bar's next length: up at once, down by `METER_FALL` a reading. */
export const meterShown = (next: number, shown: number): number => Math.max(next, shown - METER_FALL);

/**
 * The loudest of the nodes `serials` name, as a bar shows it; 0 with no
 * meters or no nodes. The recorders run while the component is on screen
 * and `serials` names a node.
 */
export function useMeterLevel(meters: StreamMeters | undefined, serials: readonly number[]): number {
  const [level, setLevel] = useState(0);
  const shown = useRef(0);
  const key = serials.join(",");
  useEffect(() => {
    const nodes = key === "" ? [] : key.split(",").map(Number);
    if (!meters || nodes.length === 0) return;
    const latest = new Map<number, number>();
    const stops = nodes.map((serial) =>
      meters.listen(serial, (next) => {
        latest.set(serial, next);
        shown.current = meterShown(Math.max(...latest.values()), shown.current);
        setLevel(shown.current);
      }),
    );
    return () => {
      for (const stop of stops) stop();
      shown.current = 0;
      setLevel(0);
    };
  }, [meters, key]);
  return level;
}
