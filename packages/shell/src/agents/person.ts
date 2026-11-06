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
export function answeredByPerson(origin: unknown): boolean {
  if (typeof origin !== "object" || origin === null) return false;
  const { person, agent } = origin as Record<string, unknown>;
  if (typeof person !== "number" || person < 0 || person > PERSON_PRESS_MS) return false;
  // An agent's press on the sheet more recently than the person's: not theirs.
  return agent === null || agent === undefined || (typeof agent === "number" && agent > person);
}

/** Ask dashi-comp about `namespace`'s last presses; anything but a clear "the person" is no. */
export async function personAnswered(request: (method: string, params: Record<string, unknown>) => Promise<unknown>, namespace: string): Promise<boolean> {
  try {
    return answeredByPerson(await request("input-origin", { namespace }));
  } catch {
    return false;
  }
}
