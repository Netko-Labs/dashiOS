/**
 * What a tool asks the person before it goes ahead. The wait itself is the
 * sheet queue's (sheet-queue.ts): an unanswered sheet counts as "Don't
 * Allow" two minutes after it is shown.
 */

/** An unanswered sheet counts as "Don't Allow" this long after it is shown. */
export const ASK_TIMEOUT_MS = 120_000;

/** What a tool asks before it goes ahead (the sheet adds who is asking). */
export interface Question {
  /** What the agent wants to do, as a phrase after "wants to": `force “Notes” to quit`. */
  summary: string;
  detail: string;
  /** The button that goes ahead. */
  action: string;
  /**
   * It loses work or can't be taken back (force quitting, the Trash): the
   * button is red. Otherwise (showing copies, installing) it is the sheet's
   * primary button: red is never a yes to something harmless.
   */
  danger?: boolean;
}
