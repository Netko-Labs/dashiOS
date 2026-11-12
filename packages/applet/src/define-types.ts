/** The shapes `defineApplet` takes and gives (define.ts): the definition, its commands, and the handle. */

import type { ComponentType } from "react";
import type { AppletsClient } from "./client.ts";
import type { CommandResult, CommandRow } from "./commands.ts";
import type { ControlsApi } from "./controls-api.ts";
import type { Manifest } from "./manifest.ts";
import type { MenuRowSpec } from "./menu.ts";
import type { WarmHost } from "./warm-host.ts";

export type Of<S, T> = T | ((state: S) => T);

export interface PopoverProps<S> {
  state: S;
  set(next: Partial<S> | ((state: S) => S)): void;
  /** Closes the popover (a choice made in it). */
  close(): void;
}

export interface AppletDefinition<S> {
  /** The item's id; the last part of the manifest's id by default. */
  id?: string;
  /** Who it is; the manifest's name by default. */
  title?: string;
  initial: S;
  glyph?: Of<S, string | undefined>;
  icon?: Of<S, string | undefined>;
  label?: Of<S, string | undefined>;
  tooltip?: Of<S, string | undefined>;
  attention?: Of<S, boolean>;
  menu?: Of<S, readonly MenuRowSpec[]>;
  onSelect?(item: string, applet: AppletHandle<S>): void;
  /** A click on the item when there is no popover. */
  onActivate?(applet: AppletHandle<S>, x: number, y: number): void;
  popover?: { width: number; height: number; component: ComponentType<PopoverProps<S>> };
  /** What the manifest's `commands` do, by id (docs/applets.md, "Commands"). */
  commands?: Record<string, CommandDefinition<S>>;
  /** Runs once at the start (live data, timers); what it returns runs at the end. */
  start?(applet: AppletHandle<S>): undefined | (() => void);
  /** Testing and the CLI: a client of your own, the manifest given. */
  client?: AppletsClient;
  manifest?: Manifest;
  /**
   * Testing: the warm host the popover and views open on (warm-host.ts), or
   * null for none. By default one is kept when there is a popover or a view.
   */
  warmHost?: WarmHost | null;
}

/** What a command comes to: a line for the launcher (a string is one), text to copy, something to open, or why not. */
export type CommandAnswer = string | CommandResult;

export type Args = Record<string, string | number | boolean>;

export interface ViewProps<S> {
  state: S;
  set(next: Partial<S> | ((state: S) => S)): void;
  args: Args;
  /** Closes the view (the launcher goes back to its rows). */
  close(): void;
}

/** One command, by its manifest mode: `run` for instant, `items` and `choose` for pick, `view` for view. */
export interface CommandDefinition<S> {
  run?(args: Args, applet: AppletHandle<S>): CommandAnswer | Promise<CommandAnswer>;
  /** The rows for what is typed; asked again on every keystroke, and the launcher waits 80 ms before it says “slow”. */
  items?(query: string, args: Args, applet: AppletHandle<S>): readonly CommandRow[] | Promise<readonly CommandRow[]>;
  choose?(item: string, args: Args, applet: AppletHandle<S>): CommandAnswer | Promise<CommandAnswer>;
  view?: { height: number; component: ComponentType<ViewProps<S>> };
}

export interface AppletHandle<S> {
  readonly state: S;
  set(next: Partial<S> | ((state: S) => S)): void;
  openPopover(): void;
  closePopover(): void;
  readonly client: AppletsClient;
  /** Its controls in Control Center (applet.json's `controls`; controls-api.ts). */
  readonly controls: ControlsApi;
  stop(): void;
}
