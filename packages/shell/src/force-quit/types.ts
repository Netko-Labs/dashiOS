/** Force Quit's public types: the handle the shell keeps, and a row of the list. */

import type { CompositorWindow } from "../compositor.ts";
import type { Outcome } from "../shared/processes/policy.ts";

export interface AppGroup {
  /** The process that owns the windows; the process Force Quit signals. */
  pid: number;
  appId: string;
  name: string;
  icon: string;
  /** Windows the process has, minimized and hidden ones included. */
  windowCount: number;
  /** The first window's title, when another row has the same name, so the two can be told apart; "" otherwise. */
  detail: string;
}

export interface ForceQuit {
  open(): void;
  close(): void;
  /** The apps the window would list for these windows: one per process, the shell's own left out. */
  apps(windows: readonly CompositorWindow[]): AppGroup[];
  /** Ends `pid` as the window's button does; nothing is sent for a process the window would not list. */
  end(pid: number, windows: readonly CompositorWindow[]): Outcome;
}
