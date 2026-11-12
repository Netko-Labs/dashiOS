import { expect, jest, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "./support/time.ts";

// test/real-clock.ts: a test that leaves the clock stopped doesn't stop it for the tests after it.

test("a test stops the clock and ends without giving it back", () => {
  fakeClock();
  expect(jest.isFakeTimers()).toBe(true);
});

test("the next test has the real clock again: timers run, and now is the disk's now", () => {
  expect(jest.isFakeTimers()).toBe(false);
  const dir = mkdtempSync(join(tmpdir(), "dashi-test-clock-"));
  try {
    // The stopped clock stood at 2026-11-05 08:00 UTC; a folder made now is from now.
    expect(Math.abs(Date.now() - statSync(dir).mtimeMs)).toBeLessThan(60_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
