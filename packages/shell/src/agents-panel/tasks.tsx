/**
 * The launcher's Ask tasks in the agents' panel (agents-panel.tsx): what a
 * click on a task's capsule in the menu bar opens. The panel is made by the
 * runs' owner (handoff-shell.tsx); the tasks come to it from around it, so
 * the bar's start-up wraps the panel in them (`withPanelTasks`).
 */

import { createContext, type ReactElement } from "react";
import type { TaskView } from "../agents/index.ts";

/** A step's way back, as the task keeps it. */
type TaskUndo = NonNullable<TaskView["steps"][number]["undo"]>;

/** What the panel reads of the Ask tasks, and does to them. */
export interface PanelTasks {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly TaskView[];
  stop(id: string): void;
  /** Put a step's settings change back. */
  undo(id: string, step: number, undo: TaskUndo): void;
  /** A plan that waits for a yes: show it where it is answered. */
  answer(id: string): void;
}

/** The Ask tasks as the panel's source wants them, from the store once it has started. */
export interface TaskStoreLike {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly TaskView[];
  stop(id: string): void;
  entryOf(id: string): string | null;
  undo(entry: string, step: number, undo: TaskUndo): Promise<unknown>;
}

const NONE: readonly TaskView[] = [];

/** The panel's tasks over a store that may not have started yet. */
export function panelTasks(store: () => TaskStoreLike | null, answer: (id: string) => void): PanelTasks {
  return {
    subscribe: (listener) => store()?.subscribe(listener) ?? (() => {}),
    getSnapshot: () => store()?.getSnapshot() ?? NONE,
    stop: (id) => store()?.stop(id),
    undo: (id, step, undo) => {
      const tasks = store();
      const entry = tasks?.entryOf(id);
      if (tasks && entry) void tasks.undo(entry, step, undo).catch((error) => console.error("dashi-shell: undo failed:", error));
    },
    answer,
  };
}

export const PanelTasksContext = createContext<PanelTasks | null>(null);

type Panel<Props> = (props: Props) => ReactElement;

/** `panel`, with the Ask tasks around it. */
export function withPanelTasks<Props>(panel: Panel<Props> | undefined, tasks: PanelTasks): Panel<Props> | undefined {
  if (!panel) return undefined;
  return (props) => <PanelTasksContext.Provider value={tasks}>{panel(props)}</PanelTasksContext.Provider>;
}
