/**
 * Where words sent to an agent go (⇥ on its row in the launcher, Follow up
 * on its notification): into its own session, so it hears them with all it
 * did. Pure; service.ts carries the route out.
 *
 * - Working, its session known: it is stopped where it is and resumed with
 *   the words (`restart`): a headless harness hears nothing until its turn
 *   ends, and that could be the whole task.
 * - Working, no session yet (it is still starting): the words wait for the
 *   session (`wait`), then go as above.
 * - Ended, its session known: resumed with the words (`resume`).
 * - Ended without one (it failed before starting): a new run, the request
 *   and the words together (`start-over`).
 */

import { isWorking, type RunView } from "./store.ts";

export type FollowUpRoute =
  | { kind: "restart"; session: string }
  | { kind: "wait" }
  | { kind: "resume"; session: string }
  | { kind: "start-over"; prompt: string };

export function followUpRoute(run: Pick<RunView, "phase" | "session" | "request">, text: string): FollowUpRoute {
  if (isWorking(run)) return run.session ? { kind: "restart", session: run.session } : { kind: "wait" };
  if (run.session) return { kind: "resume", session: run.session };
  return { kind: "start-over", prompt: `${run.request}\n\n${text}` };
}

/** What a resumed harness is told: that the person stopped it to add something, then the words. */
export function followUpPrompt(text: string, interrupted: boolean): string {
  return interrupted
    ? `The person stopped you to add this. Take it into account and carry on with the task:\n\n${text}`
    : `The person follows up on the task:\n\n${text}`;
}
