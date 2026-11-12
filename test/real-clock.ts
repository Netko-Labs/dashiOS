/**
 * A test that stops the clock (`fakeClock()`, test/support/time.ts) and ends
 * before it gives it back (an assertion that throws, the 2 s limit under
 * load) must not leave it stopped: Bun keeps the fake timers and the fake
 * `Date` for every test after it, in every later file of the run, where
 * `settle()` then moves a clock nobody set and a file's real time is days
 * from `Date.now()`. One failure became several, in tests that had nothing
 * wrong with them. After each test the real clock is back, whoever stopped it.
 *
 * Preloaded with isolate-home.ts by every bunfig.toml.
 */
import { afterEach, jest, setSystemTime } from "bun:test";

afterEach(() => {
  if (!jest.isFakeTimers()) return;
  jest.useRealTimers();
  setSystemTime();
});
