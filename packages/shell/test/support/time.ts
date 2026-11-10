/**
 * Time in tests (H11: tests never wait on real time).
 *
 * - `flush()` lets pending promises, React's scheduler and mirin's test
 *   renderer finish, without sleeping. React schedules its work on
 *   `setImmediate`, so a few turns of the event loop are enough; no clock runs.
 * - `until()` is for work that finishes outside the event loop's own turns (a
 *   socket, a file, a child process): it turns the loop until a condition holds.
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

/** `flush()` under the name the tests have always used; the argument is ignored (it was a delay in ms). */
export const settle = (_ms?: number): Promise<void> => flush();

/**
 * Turn the event loop until `ready()` holds, for work that ends outside it (a socket, a file, a child
 * process). It counts turns, not milliseconds; it throws when `turns` run out.
 */
export async function until(ready: () => boolean | Promise<boolean>, what = "the condition", turns = 20_000): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    if (await ready()) return;
    await new Promise<void>((done) => setImmediate(done));
  }
  throw new Error(`gave up waiting for ${what}`);
}

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
  setSystemTime(start);
  return {
    async advance(ms, step = ms) {
      // Promises first: what they set going (a timer, say) is then on the clock before time moves.
      await flush(2);
      for (let moved = 0; moved < ms; moved += step) {
        jest.advanceTimersByTime(Math.min(step, ms - moved));
        await flush(2);
      }
    },
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
