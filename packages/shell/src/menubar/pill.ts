/** What a menu bar is given for Dashi's mark, the jobs beside it and the field (boot/bars.tsx makes it). */

import type { PillHub } from "../shared/pill/index.ts";
import type { BarField } from "./field.ts";
import type { BarJobs } from "./jobs.ts";

export interface BarPill {
  /** Where the night build's pieces meet (shared/pill): the asks, the persona, the commands. */
  hub: Pick<PillHub, "asks" | "persona" | "voiceCommands">;
  jobs: BarJobs;
  field: BarField;
  /** Stop a launcher Ask task (the square on its capsule). */
  stopTask(id: string): void;
  /** A task's plan waits for a yes and no card took it: show it where it can be answered (the launcher). */
  showTask(id: string): void;
}

/** The agents' panel's focus for an Ask task's card (agents-panel/). */
export const taskFocus = (id: string): string => `task:${id}`;
