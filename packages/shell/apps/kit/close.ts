/**
 * A close that asks (design.html PA-4). When the compositor or the shell asks
 * a Dashi app's window to close (the close control, ❖W, ❖Q, the Dock's Quit,
 * logging out), mirin hands the app a close request instead of closing
 * (`askToClose`, mirin's docs/metal.md). The app answers here:
 *
 *   useCloseRequest(() => (dirty ? setSheet({ kind: "unsaved" }) : quit()));
 *
 * The answer closes the window (the app's own quit) or keeps it and asks:
 * one confirm sheet, after which it closes or not. An app that set no answer
 * has nothing to lose and closes at once. A hung app never answers; the
 * shell's Force Quit still ends it.
 */

import { useEffect, useRef } from "react";

/** What a close request does: close (the app's quit), or keep the window and ask first. */
export type CloseAnswer = () => void;

export class CloseRequests {
  private answers: CloseAnswer[] = [];

  /** Sets the answer; the newest set wins. Returns the way to take it back. */
  answer(answer: CloseAnswer): () => void {
    this.answers.push(answer);
    return () => {
      this.answers = this.answers.filter((each) => each !== answer);
    };
  }

  /** Whether some answer is set (the app may ask). */
  get isAnswered(): boolean {
    return this.answers.length > 0;
  }

  /** A close request came: the app's answer, or `closeNow` when it set none. */
  request(closeNow: () => void): void {
    const answer = this.answers.at(-1);
    if (answer) answer();
    else closeNow();
  }
}

/** The process's close requests: one window per process, as Dashi's apps are. */
export const closeRequests = new CloseRequests();

/**
 * Answers close requests while mounted: `answer` closes (the app's quit) or
 * asks first. The latest `answer` given is the one called.
 */
export function useCloseRequest(answer: CloseAnswer, requests: CloseRequests = closeRequests): void {
  const latest = useRef(answer);
  latest.current = answer;
  useEffect(() => requests.answer(() => latest.current()), [requests]);
}
