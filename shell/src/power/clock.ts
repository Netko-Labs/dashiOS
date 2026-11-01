/** Time, as the power code sees it, so tests can move it by hand. */

export interface Clock {
  /** Run `run` after `ms`; the returned function cancels it. */
  after(ms: number, run: () => void): () => void;
}

export const systemClock: Clock = {
  after(ms, run) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

export const wait = (clock: Clock, ms: number): Promise<void> => new Promise((resolve) => clock.after(ms, resolve));
