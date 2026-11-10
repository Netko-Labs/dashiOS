/**
 * Control Center's two motions (docs/design.html, Motion): a tile's corners
 * tighten from 28 to 18 as it turns on, and a page grows out of the tile it
 * was opened from, both on a 220 ms spring. Metal has no transitions for
 * either, so the value is stepped here, at most 220 ms, only while it
 * moves; with Reduce Motion it is simply there.
 */

import { useEffect, useRef, useState } from "react";

/** Past 1 a little and back (an underdamped spring, settled at t = 1): the Dock's icons and these. */
export const springOut = (t: number): number => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.exp(-6 * t) * Math.cos(9 * t) * (1 - t ** 8);
};

/** The spring's length. */
export const CONTROL_MOTION_MS = 220;
const FRAME_MS = 16;

/** Reduce Motion, as the shell knows it; main.tsx connects it. */
let reduceMotion: () => boolean = () => false;

export function setControlMotion(reduce: () => boolean): void {
  reduceMotion = reduce;
}

/** Where a value is `t` of the way (0..1) along the spring from `from` to `to`. */
export const springAt = (from: number, to: number, t: number): number => from + (to - from) * springOut(Math.min(Math.max(t, 0), 1));

/** `target`, reached over the spring whenever it changes (at once with Reduce Motion, and on the first render). */
export function useSpring(target: number, ms: number = CONTROL_MOTION_MS): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    if (from === target) return;
    if (reduceMotion()) {
      current.current = target;
      setValue(target);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      const t = (Date.now() - start) / ms;
      const next = t >= 1 ? target : springAt(from, target, t);
      current.current = next;
      setValue(next);
      if (t >= 1) clearInterval(timer);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [target, ms]);
  return value;
}

/** 0 on the first render, then 1 over the spring: a page growing in. */
export function useGrow(): number {
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  return useSpring(shown ? 1 : 0);
}
