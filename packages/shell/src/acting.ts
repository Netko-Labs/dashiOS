/**
 * Who is acting: the person, or an agent on their behalf. An agent's tool
 * call runs inside `actingAs` (agents/session.ts, and a launcher Ask's
 * approved step: actions/start.ts), and whatever it changes reads `actor()`
 * through every await in between, so Settings can say who changed a setting
 * (settings-app/changes/). Outside of `actingAs` it is the person.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface Actor {
  /** What the agent is called where it is shown: its process name, or the answerer's ("Claude"). */
  agent: string;
  /** Its key in the kept answers (agents/consent.ts), where it has one, so Settings › Agents can list what it did. */
  key?: string;
}

const acting = new AsyncLocalStorage<Actor>();

/** Runs `work` (and everything it awaits) as `who`. */
export function actingAs<T>(who: Actor, work: () => T): T {
  return acting.run(who, work);
}

/** The agent acting now; null when it is the person. */
export function actor(): Actor | null {
  return acting.getStore() ?? null;
}
