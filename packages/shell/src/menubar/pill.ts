/**
 * What a menu bar is given of Dashi's own agent (boot/bars.tsx makes it):
 * nothing of it shows at rest (decisions.md D261). The persona's colour and
 * mark for the one indicator, and which of the assistant's connections are
 * its foreground turns (in the capsule or the launcher, where the person
 * already watches them): those are not in the bar; a turn kept working on
 * its own is.
 */

import type { PillHub } from "../shared/pill/index.ts";

export interface BarPill {
  hub: Pick<PillHub, "persona">;
  /** A connection of task `task` is Dashi's own agent in front of the person (the capsule, the launcher): not shown in the bar. */
  foreground(task: string): boolean;
}
