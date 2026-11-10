/**
 * The applets channel's constants and message types (protocol.ts has the
 * protocol itself, in its header; protocol-applet.ts and protocol-shell.ts
 * parse each direction).
 */

import { join } from "node:path";
import type { CommandResult, CommandRow } from "./commands.ts";
import type { ControlAction, ControlUpdate } from "./controls.ts";
import type { Manifest } from "./manifest.ts";
import type { AppletMenuRow } from "./menu.ts";
import type { PowerChoice, PowerState } from "./power.ts";

export const PROTOCOL = 5;
export const APPLETS_SOCKET = "dashi-applets.sock";

/** Where the shell listens; null without a runtime directory. `DASHI_APPLETS_SOCKET` puts it elsewhere (the sandbox's own). */
export function appletsSocketPath(env: Record<string, string | undefined> = process.env): string | null {
  if (env.DASHI_APPLETS_SOCKET) return env.DASHI_APPLETS_SOCKET;
  const dir = env.XDG_RUNTIME_DIR;
  return dir ? join(dir, APPLETS_SOCKET) : null;
}

export const APPLET_LIMITS = {
  /** Bytes in one line; a longer one ends the connection. */
  line: 64 * 1024,
  /** Applets one connection may show at once. */
  perConnection: 8,
  title: 40,
  /** A label is short: the bar is shared. */
  label: 24,
  tooltip: 160,
  /** Bytes of SVG markup in a glyph. */
  glyph: 16 * 1024,
  /** Bytes of an icon file. */
  icon: 1024 * 1024,
  rows: 40,
  /** A popover's size in points: the smallest and largest asked for. */
  popover: { minWidth: 120, minHeight: 48, maxWidth: 720, maxHeight: 900 },
} as const;

export interface Applet {
  id: string;
  title: string;
  glyph?: string;
  icon?: string;
  label?: string;
  tooltip?: string;
  menu: AppletMenuRow[];
  /** What a primary click does. */
  click: "activate" | "menu";
  attention: boolean;
}

export type AppletMessage =
  | { type: "hello"; protocol: number; manifest: Manifest; dev: boolean }
  | { type: "applet"; applet: Applet }
  | { type: "remove"; id: string }
  | { type: "popover"; id: string; width: number; height: number }
  | { type: "dismiss"; id: string }
  | { type: "result"; seq: number; result: CommandResult }
  | { type: "items"; seq: number; rows: CommandRow[] }
  | { type: "view"; seq: number; height: number }
  /** `{"type":"dismiss","seq"}`: the view of run `seq` closed. */
  | { type: "dismiss-view"; seq: number }
  /** Version 4: Automatic or a mode, asked for (`power.mode`). */
  | { type: "power"; choice: PowerChoice }
  /** Version 5: a control's state (`controls`). */
  | ({ type: "control" } & ControlUpdate);

/** A command run's number: the shell counts them up from 1. */
export const MAX_SEQ = 2 ** 31;

/** Where the shell put a popover: the top-left corner in the screen's own points, on `output`, and the size it may take. */
export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The screen (output name) or null when the shell can't tell. */
  output: string | null;
}

export type AppletShellMessage =
  | { type: "welcome"; protocol: number }
  | { type: "activate"; id: string; x: number; y: number }
  | { type: "select"; id: string; item: string }
  | { type: "error"; message: string }
  | ({ type: "popover"; id: string; namespace: string } & Placement)
  | { type: "dismiss"; id: string }
  | { type: "run"; seq: number; command: string; args: Record<string, string | number | boolean>; query?: string; item?: string }
  | ({ type: "view"; seq: number; namespace: string } & Placement)
  | { type: "dismiss-view"; seq: number }
  | ({ type: "power" } & PowerState)
  /** Version 5: which of its controls are in Control Center. */
  | { type: "controls"; shown: string[] }
  /** Version 5: one of its controls was pressed. */
  | ({ type: "control-action"; id: string } & ControlAction);
