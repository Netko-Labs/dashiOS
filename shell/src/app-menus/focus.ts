/**
 * Which process owns the focused window, for the menus channel. The menu
 * bar hears focus move through foreign toplevels, which carry no process,
 * so each time the active window changes the compositor is asked for its
 * windows (IPC `windows`, which has `pid`). Answers can come back out of
 * order; only the latest question's counts.
 */

import { readFileSync } from "node:fs";
import type { CompositorWindow } from "../compositor.ts";
import { parseStat } from "../agents/peer.ts";

/** `pid`'s parent, from /proc; null when it is gone or init's. */
export function parentPid(pid: number): number | null {
  try {
    const ppid = parseStat(readFileSync(`/proc/${pid}/stat`, "utf8"))?.ppid ?? 0;
    return ppid > 1 ? ppid : null;
  } catch {
    return null;
  }
}

/** The processes a window's menus may come from: its own, then its parent's (a Metal host's app). */
export function ownerPids(pid: number | null, parent: (pid: number) => number | null = parentPid): number[] {
  if (pid === null || pid <= 1) return [];
  const up = parent(pid);
  return up === null ? [pid] : [pid, up];
}

export interface FocusOptions {
  /** The active toplevel's id now (null: none), and a way to hear it change. */
  active(): number | null;
  subscribe(listener: () => void): () => void;
  windows(): Promise<readonly CompositorWindow[]>;
  onFocus(pids: readonly number[]): void;
  parent?(pid: number): number | null;
}

export class FocusFollower {
  private last: number | null | undefined = undefined;
  private serial = 0;
  private readonly stop: () => void;

  constructor(private readonly options: FocusOptions) {
    this.stop = options.subscribe(() => this.changed());
    this.changed();
  }

  /** Ask again even though the active window looks the same (a popover just closed). */
  refresh(): void {
    this.last = undefined;
    this.changed();
  }

  close(): void {
    this.serial++;
    this.stop();
  }

  private changed(): void {
    const active = this.options.active();
    if (active === this.last) return;
    this.last = active;
    const serial = ++this.serial;
    if (active === null) {
      this.options.onFocus([]);
      return;
    }
    this.options
      .windows()
      .then((windows) => {
        if (serial !== this.serial) return;
        const focused = windows.find((window) => window.focused);
        this.options.onFocus(ownerPids(focused?.pid ?? null, this.options.parent));
      })
      .catch(() => {
        if (serial === this.serial) this.options.onFocus([]);
      });
  }
}
