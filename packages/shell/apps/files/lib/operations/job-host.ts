/**
 * What a job module (transfer.ts, trash-jobs.ts) uses of the operations it
 * runs for: the store, the jobs and the undo stack, the outcome line, and
 * the question a name collision asks.
 */

import type { UndoStack } from "@dashi/ui";
import type { FilesStore } from "../store/store.ts";
import type { Answer, Conflict } from "./conflicts.ts";
import type { Jobs } from "./jobs.ts";
import type { UndoEnv } from "./undoable.ts";

export interface JobHost {
  readonly store: FilesStore;
  readonly jobs: Jobs;
  readonly undo: UndoStack;
  readonly undoEnv: UndoEnv;
  ask: ((conflict: Conflict) => Promise<Answer>) | null;
  /** `undoable`: a step was just pushed, and the notice offers Undo for it (and only it). */
  finished(state: string, message: string | null, created: readonly string[], undoable?: boolean): void;
}
