/**
 * Whether the Desktops row is open and which picture a dragged window is
 * over, as a small store: the pointer opens it (and a short grace after it
 * leaves closes it), a drag in Mission Control lifts the picture under it.
 * The timer is handed in, so the rules are tested without waiting.
 */

import type { RowView } from "./row.tsx";

/** The pointer can leave the row this long before it closes (crossing a gap, a slip). */
export const CLOSE_AFTER_MS = 250;

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class RowViewStore {
  private view: RowView = { open: false, lifted: null };
  private readonly listeners = new Set<() => void>();
  private closing: unknown = null;
  private dragging: number | null = null;
  private over: number | null = null;
  /** The parts of the row the pointer is on. */
  private readonly hovered = new Set<string>();

  constructor(private readonly timers: Timers = realTimers) {}

  getSnapshot = (): RowView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The window being dragged in Mission Control, if one is. */
  get draggedWindow(): number | null {
    return this.dragging;
  }

  /**
   * The pointer came onto a part of the row (it opens) or left it (it closes
   * a moment later, once it is on none). A part that takes the pointer from
   * the row under it (the ×, which occludes) counts as the row, so moving
   * onto it doesn't close the row.
   */
  hover(hovered: boolean, part = "row"): void {
    if (this.closing !== null) this.timers.clear(this.closing);
    this.closing = null;
    if (hovered) this.hovered.add(part);
    else this.hovered.delete(part);
    if (this.hovered.size > 0) {
      this.set({ open: true });
      return;
    }
    this.closing = this.timers.set(() => {
      this.closing = null;
      this.over = null;
      this.set({ open: false, lifted: null });
    }, CLOSE_AFTER_MS);
  }

  /** The pointer is over Desktop `index` (its picture or name), or left it. */
  overSpace(index: number, over: boolean): void {
    if (over) this.over = index;
    else if (this.over === index) this.over = null;
    this.set({});
  }

  /** A drag began in Mission Control (window), or ended (null). */
  drag(window: number | null): void {
    this.dragging = window;
    this.set({});
  }

  /** Mission Control closed: the row starts closed next time. */
  reset(): void {
    if (this.closing !== null) this.timers.clear(this.closing);
    this.closing = null;
    this.hovered.clear();
    this.dragging = null;
    this.over = null;
    this.set({ open: false, lifted: null });
  }

  private set(change: Partial<RowView>): void {
    const open = change.open ?? this.view.open;
    const lifted = open && this.dragging !== null ? this.over : null;
    if (open === this.view.open && lifted === this.view.lifted) return;
    this.view = { open, lifted };
    for (const listener of this.listeners) listener();
  }
}
