/**
 * Undo and Redo for an app's own actions (design.html PA-2, KB-4): rename,
 * move, trash, a deleted note, a moved event, a setting that is one value.
 * Each action is pushed once it is done, with a name and the two ways to go
 * (`do`, `undo`); Edit › Undo and Redo name it ("Undo Rename", "Redo Move to
 * Trash") and take ❖Z and ⇧❖Z (`undoMenuItems`). Actions pushed inside
 * `group` (or between `begin` and `end`) are one step: trashing five files is
 * one Undo, and an action that `joins` the newest step (a slider dragged,
 * the same setting changed again within `JOIN_MS`) becomes part of it. The
 * stack keeps the newest `limit` steps; a new action drops whatever could be
 * redone.
 *
 *   const undo = useMemo(() => new UndoStack(), []);
 *   undo.push({ name: "Rename", do: () => rename(a, b), undo: () => rename(b, a) });
 *   const state = useUndo(undo);        // { undoName: "Rename", ... }
 *   items: [...undoMenuItems(state), …]   // "Undo Rename" ❖Z, "Redo" ⇧❖Z
 *
 * Text Editor keeps its own text history (per keystroke run) but labels its
 * rows with `undoLabel`/`redoLabel`, so every app's Edit menu reads the same.
 */

import { useSyncExternalStore } from "react";

export interface UndoAction {
  /** What the menu says after Undo/Redo: "Rename", "Move to Trash", "Delete Note". */
  name: string;
  /** Does it again (Redo). */
  do(): void | Promise<void>;
  /** Takes it back (Undo). */
  undo(): void | Promise<void>;
  /**
   * Joins the newest step when that one has the same `joins` and came within
   * `JOIN_MS`: Undo then takes back both (the first one's undo), Redo does the
   * last one's `do`. A setting's id, so a slider's drag is one step.
   */
  joins?: string;
}

/** What the menus show: whether each way can go, and the name it would say. */
export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undoName: string | null;
  redoName: string | null;
  /** An Undo or Redo is running (one at a time). */
  busy: boolean;
  /**
   * Which step Undo takes back now (null: none), the same number for as long
   * as that step is the newest. A notice that offers Undo for one step keeps
   * it, and offers Undo only while it is still this one (Files' "Moved to
   * the Trash", design.html PA-2), never a newer step's.
   */
  undoStep: number | null;
}

/** How many steps an app's Undo can take back. */
export const UNDO_LIMIT = 100;
/** How soon after the newest step an action with its `joins` still joins it. */
export const JOIN_MS = 1500;

/** "Undo Rename", or "Undo" with nothing named. */
export function undoLabel(name: string | null | undefined): string {
  return name ? `Undo ${name}` : "Undo";
}

/** "Redo Rename", or "Redo" with nothing named. */
export function redoLabel(name: string | null | undefined): string {
  return name ? `Redo ${name}` : "Redo";
}

/** Edit's first two rows, as the kit's menus take them: ids `undo` and `redo`. */
export function undoMenuItems(
  state: Pick<UndoState, "canUndo" | "canRedo" | "undoName" | "redoName" | "busy">,
): [{ id: "undo"; label: string; shortcut: "❖Z"; enabled: boolean }, { id: "redo"; label: string; shortcut: "⇧❖Z"; enabled: boolean }] {
  return [
    { id: "undo", label: undoLabel(state.canUndo ? state.undoName : null), shortcut: "❖Z", enabled: state.canUndo && !state.busy },
    { id: "redo", label: redoLabel(state.canRedo ? state.redoName : null), shortcut: "⇧❖Z", enabled: state.canRedo && !state.busy },
  ];
}

/** One step: one action, or a group's, done and undone together. */
interface Step {
  name: string;
  actions: UndoAction[];
  /** The `joins` of a step made of one joinable action, and when it was last joined. */
  joins?: string;
  at?: number;
  /** Given as it is recorded (`undoStep`). */
  id?: number;
}

const EMPTY: UndoState = { canUndo: false, canRedo: false, undoName: null, redoName: null, busy: false, undoStep: null };

export class UndoStack {
  private steps = 0;
  private past: Step[] = [];
  private future: Step[] = [];
  /** Open groups, outermost first: what is pushed meanwhile joins the outermost. */
  private open: Step[] = [];
  private running = false;
  private snapshot: UndoState = EMPTY;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly limit: number = UNDO_LIMIT,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Records an action that was just done. Inside a group it joins the group's
   * step. While an Undo or Redo runs nothing is recorded, so an app may undo
   * through the same code that records (a rename back is not a new Rename).
   */
  push(action: UndoAction): void {
    if (this.running) return;
    const group = this.open[0];
    if (group) {
      group.actions.push(action);
      return;
    }
    const at = this.now();
    const last = this.past.at(-1);
    const first = last?.actions[0];
    if (action.joins !== undefined && last?.joins === action.joins && first && last.at !== undefined && at - last.at <= JOIN_MS) {
      last.actions = [{ name: last.name, undo: () => first.undo(), do: () => action.do() }];
      last.at = at;
      this.future = [];
      this.changed();
      return;
    }
    this.record({ name: action.name, actions: [action], ...(action.joins !== undefined ? { joins: action.joins, at } : {}) });
  }

  /** Starts a step named `name`; every action pushed until the matching `end` is part of it. Groups nest into the outermost. */
  begin(name: string): void {
    this.open.push({ name, actions: [] });
  }

  /** Ends the innermost group; the outermost one, once it ends, is a step (none if nothing was pushed). */
  end(): void {
    const step = this.open.pop();
    if (!step || this.open.length > 0) return;
    if (step.actions.length > 0) this.record(step);
  }

  /** Runs `fn` as one step named `name` (it may be async: the step ends when it settles). */
  group<T>(name: string, fn: () => T): T {
    this.begin(name);
    let result: T;
    try {
      result = fn();
    } catch (error) {
      this.end();
      throw error;
    }
    if (result instanceof Promise) {
      return result.finally(() => this.end()) as T;
    }
    this.end();
    return result;
  }

  /** Takes back the newest step; false when there was none (or one is running). A step whose undo fails is dropped. */
  async undo(): Promise<boolean> {
    return this.move(this.past, this.future, (step) => [...step.actions].reverse().map((action) => () => action.undo()));
  }

  /** Does the newest undone step again; false when there was none (or one is running). */
  async redo(): Promise<boolean> {
    return this.move(this.future, this.past, (step) => step.actions.map((action) => () => action.do()));
  }

  /** Forgets every step (the document they touched is gone). */
  clear(): void {
    this.past = [];
    this.future = [];
    this.changed();
  }

  get state(): UndoState {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private record(step: Step): void {
    step.id = ++this.steps;
    this.past.push(step);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.future = [];
    this.changed();
  }

  private async move(from: Step[], to: Step[], calls: (step: Step) => Array<() => void | Promise<void>>): Promise<boolean> {
    if (this.running) return false;
    const step = from.pop();
    if (!step) return false;
    this.running = true;
    this.changed();
    try {
      for (const call of calls(step)) await call();
      // A step that went one way is done joining.
      delete step.joins;
      to.push(step);
      return true;
    } finally {
      // A failed step is dropped from both ways: what it would do can't be trusted now.
      this.running = false;
      this.changed();
    }
  }

  private changed(): void {
    const past = this.past.at(-1);
    const future = this.future.at(-1);
    this.snapshot = {
      canUndo: past !== undefined,
      canRedo: future !== undefined,
      undoName: past?.name ?? null,
      redoName: future?.name ?? null,
      busy: this.running,
      undoStep: past?.id ?? null,
    };
    for (const listener of this.listeners) listener();
  }
}

/** The stack's state, kept current in a component. */
export function useUndo(stack: UndoStack): UndoState {
  return useSyncExternalStore(
    (listener) => stack.subscribe(listener),
    () => stack.state,
  );
}
