/**
 * The trial of a change: the question put to the person and the clock that
 * answers "no" when they do not answer in time. The manager (manager.ts)
 * decides what to do with the answer; this only asks and waits.
 */

/** How long a trial lasts before the old arrangement returns. */
export const KEEP_SECONDS = 15;

/** The question put to the person. */
export interface KeepAsk {
  /** What changed, in a few words: "Resolution of Dell U2720Q". */
  summary: string;
  /** When the trial ends (ms since the epoch), so the sheet's countdown matches. */
  deadline: number;
  /** The person's answer: true keeps the change. */
  answer(keep: boolean): void;
}

/** Shows the question; returns the way to take it away. */
export type AskToKeep = (ask: KeepAsk) => () => void;

const later = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/** Asks the person; true to keep. No answer in time is no. */
export function askToKeep(ask: AskToKeep, summary: string, now: () => number, schedule: (fn: () => void, ms: number) => () => void): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let take = (): void => {};
    let cancel = (): void => {};
    let settled = false;
    const finish = (keep: boolean): void => {
      if (settled) return;
      settled = true;
      cancel();
      take();
      resolve(keep);
    };
    take = ask({ summary, deadline: now() + KEEP_SECONDS * 1000, answer: finish });
    // The sheet may have answered while it opened.
    if (settled) take();
    else cancel = schedule(() => finish(false), KEEP_SECONDS * 1000);
  });
}

export { later };
