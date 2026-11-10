/** A clock and timers the test moves by hand. */
export function fakeTime(): { now: () => number; later: (fn: () => void, ms: number) => () => void; advance: (ms: number) => void } {
  let now = 0;
  let timers: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => now,
    later: (fn: () => void, ms: number) => {
      const timer = { at: now + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((timer) => timer.live && timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        next.live = false;
        next.fn();
      }
      timers = timers.filter((timer) => timer.live);
      now = end;
    },
  };
}
