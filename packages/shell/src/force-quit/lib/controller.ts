/**
 * The Force Quit window's state and what its keys and buttons do. The list
 * shows the apps with windows. Choosing Force Quit asks in the same window,
 * and confirming ends the process (policy.ts). Every change reads the window
 * list again, so the list follows windows opening and closing.
 */

import type { CompositorWindow } from "../../compositor.ts";
import { type Outcome, type Signal, type SignalResult, terminate } from "../../shared/processes/policy.ts";
import type { AppGroup } from "../types.ts";
import { appGroups, type Identity, indexOfPid, keepSelection, moveSelection, revealTop } from "./model.ts";

export interface ForceQuitState {
  /** False until the first list arrives, so the window is blank rather than "no apps" meanwhile. */
  loaded: boolean;
  groups: readonly AppGroup[];
  selected: number | null;
  /** The first row on screen; the list scrolls only to keep the selection visible. */
  top: number;
  /** The process the question is about, while the window asks; null otherwise. */
  asking: number | null;
}

export interface ForceQuitDeps {
  windows(): Promise<CompositorWindow[]>;
  identify(window: CompositorWindow): Identity;
  protectedPids: ReadonlySet<number>;
  signal(pid: number, signal: Signal): SignalResult;
  alive(pid: number): boolean;
  later(ms: number, run: () => void): void;
  /** Closes the window (Esc in the list). */
  close(): void;
}

const INITIAL: ForceQuitState = { loaded: false, groups: [], selected: null, top: 0, asking: null };

export class ForceQuitController {
  private state: ForceQuitState = INITIAL;
  /** Bumped by each refresh; only the newest read is shown, so a late answer cannot undo a newer one. */
  private sequence = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: ForceQuitDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ForceQuitState => this.state;

  /** Reads the windows and rebuilds the list, keeping the selection and any question still about a listed app. */
  async refresh(): Promise<void> {
    const sequence = ++this.sequence;
    const windows = await this.listWindows();
    if (!windows || sequence !== this.sequence) return;
    const groups = appGroups(windows, this.deps.protectedPids, this.deps.identify);
    const selected = keepSelection(groups, this.state.selected);
    const asking = indexOfPid(groups, this.state.asking) >= 0 ? this.state.asking : null;
    const top = revealTop(this.state.top, indexOfPid(groups, selected), groups.length);
    this.set({ loaded: true, groups, selected, top, asking });
  }

  /** A click on a row. */
  select(pid: number): void {
    if (this.state.asking !== null || indexOfPid(this.state.groups, pid) < 0) return;
    this.choose(pid);
  }

  /** ↑ or ↓: the selection moves one row, and the list follows it. */
  move(direction: "up" | "down"): void {
    if (this.state.asking !== null) return;
    this.choose(moveSelection(this.state.groups, this.state.selected, direction));
  }

  /** The Force Quit button, or Enter: asks about the selected app, in this window. */
  ask(): void {
    if (this.state.selected === null || this.state.asking !== null) return;
    this.set({ ...this.state, asking: this.state.selected });
  }

  /** Enter. It only asks, never confirms, so a stray key cannot end an app. */
  submit(): void {
    this.ask();
  }

  /** The question's Cancel: back to the list. */
  cancel(): void {
    if (this.state.asking === null) return;
    this.set({ ...this.state, asking: null });
  }

  /** Esc backs out of the question, or closes the window from the list. */
  escape(): void {
    if (this.state.asking !== null) this.cancel();
    else this.deps.close();
  }

  /** The question's Force Quit: ends the app (policy.ts), then shows the list again. */
  async confirm(): Promise<void> {
    const pid = this.state.asking;
    if (pid === null) return;
    this.set({ ...this.state, asking: null });
    const windows = await this.listWindows();
    if (!windows) return;
    const listed = new Set(windows.flatMap((window) => (window.pid === null ? [] : [window.pid])));
    const outcome: Outcome = terminate(pid, {
      listed,
      protected: this.deps.protectedPids,
      signal: this.deps.signal,
      alive: this.deps.alive,
      later: this.deps.later,
    });
    if (outcome.kind === "refused") console.error(`dashi-shell: force quit did not end process ${pid}: ${outcome.reason}`);
    await this.refresh();
  }

  private choose(pid: number | null): void {
    const { groups, top } = this.state;
    this.set({ ...this.state, selected: pid, top: revealTop(top, indexOfPid(groups, pid), groups.length) });
  }

  private async listWindows(): Promise<CompositorWindow[] | null> {
    try {
      return await this.deps.windows();
    } catch (error) {
      console.error("dashi-shell: force quit could not list the windows:", error);
      return null;
    }
  }

  private set(state: ForceQuitState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
