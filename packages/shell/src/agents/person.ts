/**
 * Consent from the person only. `agent-input` can borrow the person's seat,
 * so a sheet can't tell from the click itself whose it was; dashi-comp
 * remembers, for each surface, when the person and when an agent last pressed
 * on it (`input-origin`). A sheet's yes counts only if the person pressed on
 * the sheet just now and no agent pressed there since. A no always counts.
 */

/** How recent the person's press must be (a click is answered on release). */
export const PERSON_PRESS_MS = 2_000;

/** Whether an `input-origin` answer says the person, not an agent, just answered. */
export function answeredByPerson({ person, agent }: { person: number | null; agent: number | null }): boolean {
  if (person === null || person < 0 || person > PERSON_PRESS_MS) return false;
  // An agent's press on the sheet more recently than the person's: not theirs.
  return agent === null || agent > person;
}

/** Ask dashi-comp about `namespace`'s last presses; anything but a clear "the person" is no. */
export async function personAnswered(
  inputOrigin: (params: { namespace: string }) => Promise<{ person: number | null; agent: number | null }>,
  namespace: string,
): Promise<boolean> {
  try {
    return answeredByPerson(await inputOrigin({ namespace }));
  } catch {
    return false;
  }
}
