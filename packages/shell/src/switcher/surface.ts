/**
 * What the switcher shows and how the shell is told about it: the state the
 * panel draws, the host that shows it, and the keys bound while a session is
 * open. The controller (controller.ts) makes these; the panel reads them.
 */

import type { CompositorWindow } from "../compositor.ts";
import type { Rect } from "../layout.ts";

export interface SwitcherApp {
  appId: string;
  title: string;
  /** How many windows it has (the badge, past one). */
  count: number;
  /** All its windows are minimized or hidden: drawn dimmed. */
  away: boolean;
}

export interface SwitcherWindow {
  id: number;
  title: string;
  state: CompositorWindow["state"];
}

export interface SwitcherState {
  apps: SwitcherApp[];
  selected: number;
  /** The chosen app's windows, when its row shows (the ones in view), and which is chosen. */
  windows: SwitcherWindow[] | null;
  /** Which of the app's windows the first one shown is (the row slides past ROW_WINDOWS). */
  windowStart: number;
  selectedWindow: number | null;
  query: string;
  /** The surface's size for the whole session (switcherSize): the panel grows inside it. */
  size: { width: number; height: number };
}

/** Where the shell shows the session. `pictures` gets each shown window's rect in the surface (empty: none). */
export interface SwitcherHost {
  show(state: SwitcherState): void;
  hide(): void;
  pictures?(rects: ReadonlyArray<{ window: number; rect: Rect }>): void;
}

/** The session's own keys: bound while it is open (keymap.ts `withSwitcher`). */
export interface SwitcherKeys {
  begin(): void;
  end(): void;
}
