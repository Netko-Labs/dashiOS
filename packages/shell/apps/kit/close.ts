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
 *
 * A quit can be called off: the person cancels the log out that asked
 * (the menus channel's `stay`). The question it put up goes with it:
 *
 *   useCloseWithdrawn(() => setSheet(null));
 */

import { useEffect, useRef } from "react";

/**
 * Why the window is asked to close: `close` (the close control, ❖W), or
 * `quit` (❖Q, Quit in the app menu, logging out), which the shell says on
 * the menus channel just before it asks (`quitting`). A question names it:
 * "Quit Terminal?", not "Close this window?".
 */
export type CloseReason = "close" | "quit";

/** What a close request does: close (the app's quit), or keep the window and ask first. */
export type CloseAnswer = (reason: CloseReason) => void;

/**
 * How long the shell's word that the app is quitting holds for the close
 * request it comes before (the request comes another way, through the
 * compositor and the Metal host).
 */
export const QUIT_HOLDS_MS = 2000;

export class CloseRequests {
  private answers: CloseAnswer[] = [];
  private withdrawals: (() => void)[] = [];
  /** Until when a close request is a quit. */
  private quitUntil = Number.NEGATIVE_INFINITY;

  constructor(private readonly now: () => number = Date.now) {}

  /** The shell is about to ask the window to close because the app quits. */
  quitting(): void {
    this.quitUntil = this.now() + QUIT_HOLDS_MS;
  }

  /** Sets the answer; the newest set wins. Returns the way to take it back. */
  answer(answer: CloseAnswer): () => void {
    this.answers.push(answer);
    return () => {
      this.answers = this.answers.filter((each) => each !== answer);
    };
  }

  /** Hears that the quit asked of the window is called off (the newest set hears it). Returns the way to take it back. */
  onWithdrawn(handler: () => void): () => void {
    this.withdrawals.push(handler);
    return () => {
      this.withdrawals = this.withdrawals.filter((each) => each !== handler);
    };
  }

  /** The shell called the quit off (a log out was cancelled): a question it put up goes. */
  withdraw(): void {
    this.quitUntil = Number.NEGATIVE_INFINITY;
    this.withdrawals.at(-1)?.();
  }

  /** Whether some answer is set (the app may ask). */
  get isAnswered(): boolean {
    return this.answers.length > 0;
  }

  /** A close request came: the app's answer, or `closeNow` when it set none. */
  request(closeNow: () => void): void {
    const reason: CloseReason = this.now() <= this.quitUntil ? "quit" : "close";
    this.quitUntil = Number.NEGATIVE_INFINITY;
    const answer = this.answers.at(-1);
    if (answer) answer(reason);
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
  useEffect(() => requests.answer((reason) => latest.current(reason)), [requests]);
}

/** While mounted, `handler` takes down the question a close asked when the shell calls the quit off (a cancelled log out). */
export function useCloseWithdrawn(handler: () => void, requests: CloseRequests = closeRequests): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => requests.onWithdrawn(() => latest.current()), [requests]);
}
