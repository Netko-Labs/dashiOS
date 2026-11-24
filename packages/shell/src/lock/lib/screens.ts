/**
 * Which screen shows the whole lock screen and which show its cover
 * (decisions.md D554): every screen is locked, each by a host of its own
 * (dashi-comp takes a lock from each and unlocks them all at the first
 * unlock). The whole lock (the widgets, the power buttons) is on the screen
 * the person was on when it locked, and stays there while that screen is
 * there; the others show the time, who is signing in and the password field,
 * so typing works wherever the pointer is (dashi-comp gives the keys to the
 * lock surface under it).
 */

export interface LockPlan {
  /** The screen of the whole lock screen; undefined: the compositor's choice (it said no screens). */
  main: string | undefined;
  /** The screens with the cover. */
  covers: string[];
}

/** `screens` in the compositor's order; `person` the screen the person is on; `main` the whole lock's screen now. */
export function planLock(screens: readonly string[], person: string | undefined, main: string | undefined): LockPlan {
  const there = (name: string | undefined): name is string => name !== undefined && screens.includes(name);
  const chosen = there(main) ? main : there(person) ? person : screens[0];
  return { main: chosen, covers: screens.filter((name) => name !== chosen) };
}
