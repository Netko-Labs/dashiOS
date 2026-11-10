/**
 * What the launcher reaches beyond its own rows: the registry's runner, the
 * windows, the Dock, the Trash, the ranking's history, the person's aliases
 * and keys. The shell wires each (boot/launcher.tsx, boot/actions.ts); a test passes what it checks.
 * Everything here runs as the person, who pressed the key.
 */

import type { ActionDef, Args, Outcome } from "../actions/types.ts";
import type { Entry } from "../entries.ts";
import type { Keymap } from "../keymap.ts";
import type { LauncherWindow } from "./items.ts";
import type { LauncherPrefsSnapshot } from "./prefs.ts";
import type { RankSignals } from "./ranking/item.ts";
import type { FileRow } from "./row-model.ts";
import type { WorldSnapshot } from "./world.ts";

export interface LauncherHost {
  /** Run a registry action for the person (actions/start.ts `run`): logged as "you". */
  run(action: ActionDef, args?: Args): Promise<Outcome>;
  /** Open System Settings at a setting's row, lit up. */
  reveal(place: { pane: string; row?: string }): void;
  /** Bring a window forward, on its Desktop (its registry action, as the person). */
  focus(window: LauncherWindow): Promise<void>;
  /** A new window of a running app (its New Window action, else started again); false when it could not. */
  newWindow(entry: Entry): boolean;
  /** Move the window to the Desktop showing, and bring it forward. */
  bringHere(window: LauncherWindow): Promise<void>;
  minimize(window: LauncherWindow): Promise<void>;
  /** Ask the window to close, as its close button does (its app asks about unsaved work). */
  close(window: LauncherWindow): Promise<void>;
  /** Ask each of these windows to close (Quit, ❖Q). */
  quit(windows: readonly LauncherWindow[]): Promise<void>;
  showInFiles(file: FileRow): void;
  /** Move a file to the Trash; whether it went. */
  trash(file: FileRow): Promise<boolean>;
  /** Whether the Dock keeps the app; null when it can't (no launcher entry). */
  pinned(entry: Entry): boolean | null;
  pin(entry: Entry, pin: boolean): void;
  /** The keymap a recorded chord is checked against, and what a binding does in words. */
  keymap(): Keymap;
  describe(bind: string): string;
}

/** The ranking's history: what it reads, and what the launcher tells it (ranking/store.ts `RankingMemory`). */
export interface LauncherRanking extends RankSignals {
  picked(query: string, id: string): void;
  opened(id: string): void;
  forget(id: string): void;
  forgetAll(): void;
}

/** A store React reads (`useSyncExternalStore`). */
export interface Store<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}

export interface LauncherPrefsStore extends Store<LauncherPrefsSnapshot> {
  setAlias(address: string, alias: string | null): void;
  setKey(address: string, when: string | null): void;
}

export type LauncherWorldStore = Store<WorldSnapshot>;

/** A `dashi://` link the launcher shows with its arguments filled in, waiting for Return (actions/run.ts `present`). */
export interface Presented {
  action: ActionDef;
  args: Args;
}
