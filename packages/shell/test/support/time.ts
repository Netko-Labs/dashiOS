/**
 * Time in tests (H11: tests never wait on real time).
 *
 * - `flush()` lets pending promises, React's scheduler and mirin's test
 *   renderer finish, without sleeping. React schedules its work on
 *   `setImmediate`, so a few turns of the event loop are enough; no clock runs.
 * - `until()` and `untilValue()` are for work that finishes outside the event loop's own
 *   turns (a socket, a file, a child process): they turn the loop until a condition holds.
 * - `fakeClock()` stops `setTimeout`, `setInterval`, `Date` and `Bun.sleep`, and
 *   moves them only when the test says (Bun's `jest.useFakeTimers`).
 *   `setImmediate` stays real, so `flush()` works with the clock stopped.
 *
 * A test file that needs the clock in every test calls `fakeClockEachTest()`
 * once at the top; one that needs it in a few calls `fakeClock()` in them and
 * `clock.restore()` after.
 */
import { afterEach, beforeEach, jest, setSystemTime } from "bun:test";

/** Turn the event loop `turns` times: every promise settles, and React's scheduled work runs. */
export async function flush(turns = 5): Promise<void> {
  for (let turn = 0; turn < turns; turn++) await new Promise<void>((done) => setImmediate(done));
}

/** Let pending promises finish, move the fake clock on by `ms` in slices of `step`, and let what that frees finish. */
async function advance(ms: number, step = ms): Promise<void> {
  // Promises first: what they set going (a timer, say) is then on the clock before time moves.
  await flush(2);
  let moved = 0;
  do {
    jest.advanceTimersByTime(Math.min(step, ms - moved));
    await flush(2);
    moved += step;
  } while (moved < ms);
}

/**
 * Let everything pending finish. With the fake clock running it also moves the clock on by `ms`, so
 * `settle(450)` runs a 400 ms debounce; with the real clock `ms` does nothing (no test waits).
 */
export async function settle(ms = 0): Promise<void> {
  if (jest.isFakeTimers()) await advance(ms);
  else await flush();
}

/**
 * Turn the event loop until `read()` gives something (not null, undefined, false, 0 or ""), for work that
 * ends outside it (a socket, a file, a child process). It does not sleep: it yields with `setImmediate` and
 * looks again. It gives up after `ms` of real time, which a stopped fake clock does not stop; that is a
 * failed test, not a wait.
 */
export async function untilValue<T>(
  read: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what = "the condition",
  ms = 5000,
): Promise<T> {
  const end = process.hrtime.bigint() + BigInt(ms) * 1_000_000n;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (process.hrtime.bigint() > end) throw new Error(`gave up waiting for ${what}`);
    await new Promise<void>((done) => setImmediate(done));
  }
}

/** `untilValue` for a yes-or-no condition. */
export async function until(ready: () => boolean | Promise<boolean>, what = "the condition", ms = 5000): Promise<void> {
  await untilValue(async () => (await ready()) || null, what, ms);
}

/** Until the mounted tree has a node with this testID (a sheet, a list that loads from disk); gives its node id. */
export const shows = (root: { nodeId(testID: string): string | undefined }, testID: string): Promise<string> =>
  untilValue(() => root.nodeId(testID), `${testID} to show`).then(async (id) => {
    await flush();
    return id;
  });

export type FakeClock = {
  /** Let pending promises finish, move time on by `ms` (in slices of `step`), run every timer that falls due, and let the promises they set free finish. */
  advance(ms: number, step?: number): Promise<void>;
  /** The fake time now, in ms since the epoch. */
  now(): number;
  /** Timers still waiting. */
  pending(): number;
  /** Give the real timers back. */
  restore(): void;
};

/** Stop the clock at `start` (default: 2026-11-05 08:00 UTC) until the test moves it. */
export function fakeClock(start: number | Date = Date.UTC(2026, 10, 5, 8, 0, 0)): FakeClock {
  jest.useFakeTimers();
  // The fake `performance.now()` starts at 0; a real one never does, and code compares it with a "never" of 0.
  jest.advanceTimersByTime(60_000);
  setSystemTime(start);
  return {
    advance,
    now: () => Date.now(),
    pending: () => jest.getTimerCount(),
    restore() {
      jest.useRealTimers();
      setSystemTime();
    },
  };
}

/** A fresh stopped clock for each test in the file, put right after it. */
export function fakeClockEachTest(start?: number | Date): FakeClock {
  let current: FakeClock | null = null;
  const now = (): FakeClock => {
    if (!current) throw new Error("the clock only runs inside a test");
    return current;
  };
  beforeEach(() => {
    current = fakeClock(start);
  });
  afterEach(() => {
    current?.restore();
    current = null;
  });
  return {
    advance: (ms, step) => now().advance(ms, step),
    now: () => now().now(),
    pending: () => now().pending(),
    restore: () => now().restore(),
  };
}
