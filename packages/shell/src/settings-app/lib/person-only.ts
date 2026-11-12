/**
 * Changes only the person makes. An agent that may click in windows can
 * press what Settings shows; where a wrong press costs something (a 1 GB
 * fetch, files removed, the key that opens the microphone, a site agents
 * may use without asking), the pane first asks the compositor whose press it
 * was (`input-origin`, agents/person.ts), as "Let agents work alone" does,
 * and an agent's changes nothing: the row says why.
 */

import { useState } from "react";

/** Whether the person's own hands, not an agent's, just pressed in System Settings. */
export type ByPerson = () => Promise<boolean>;

/** What a row says when an agent pressed it. */
export const ONLY_YOU = "Only you can change this. Press it yourself, here.";

/**
 * Make `change` if the press was the person's; whether it was. Without a way
 * to ask (no compositor, so no agent's pointer either) the press is theirs;
 * a question that fails is a no.
 */
export async function personOnly(byPerson: ByPerson | undefined, change: () => void): Promise<boolean> {
  let person = byPerson === undefined;
  try {
    if (byPerson) person = await byPerson();
  } catch {
    person = false;
  }
  if (person) change();
  return person;
}

export interface PersonOnly {
  /** The row whose last press was not the person's; it says `ONLY_YOU`. */
  refused: string | null;
  /** Make `change` for `row` if the person pressed. */
  mine(row: string, change: () => void): void;
}

/** A pane's guard: `mine(row, change)` for each change only the person makes, and which row to say so on. */
export function usePersonOnly(byPerson: ByPerson | undefined): PersonOnly {
  const [refused, setRefused] = useState<string | null>(null);
  return {
    refused,
    mine: (row, change) => void personOnly(byPerson, change).then((person) => setRefused(person ? null : row)),
  };
}
