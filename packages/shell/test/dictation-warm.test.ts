// Pass 37: the first dictation after the correcting model started missed its 1.2 s deadline (`why=deadline`): the
// model only began to load at the key's press. It loads a little after login, and when Voice and tidying turn on.

import { expect, test } from "bun:test";
import { WARM_AFTER_LOGIN_MS, warmWhenWanted } from "../src/boot/index.ts";

function rig(on: boolean) {
  const state = { on, warmed: 0 };
  const listeners = new Set<() => void>();
  const pending: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const stop = warmWhenWanted({
    wanted: () => state.on,
    warm: () => void state.warmed++,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    later: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      pending.push(timer);
      return () => (timer.cancelled = true);
    },
  });
  const change = (next: boolean): void => {
    state.on = next;
    for (const listener of [...listeners]) listener();
  };
  const elapse = (): void => {
    for (const timer of pending.splice(0)) if (!timer.cancelled) timer.run();
  };
  return { state, change, elapse, pending, stop };
}

test("on at login: the model loads a little after, once", () => {
  const { state, elapse, pending, change } = rig(true);
  expect(state.warmed).toBe(0);
  expect(pending[0]?.ms).toBe(WARM_AFTER_LOGIN_MS);
  elapse();
  expect(state.warmed).toBe(1);
  // Another setting changing (it is still on) loads nothing again: the rewriter's idle rule is left alone.
  change(true);
  expect(state.warmed).toBe(1);
});

test("off at login: nothing loads; turned on (Settings › Voice or settings.json), it loads at once", () => {
  const { state, elapse, change } = rig(false);
  elapse();
  expect(state.warmed).toBe(0);
  change(true);
  expect(state.warmed).toBe(1);
  change(false);
  change(true);
  expect(state.warmed).toBe(2);
});

test("stopped before login's wait ends: nothing loads", () => {
  const { state, elapse, stop, change } = rig(true);
  stop();
  elapse();
  change(false);
  change(true);
  expect(state.warmed).toBe(0);
});
