/**
 * Applets' controls as Control Center's tiles (docs/applets.md, "Version 5:
 * Control Center"): what the shell's side of the channel
 * (applets/controls.ts) hands the panel. Dashi draws them as its own tiles;
 * nothing of the applet's drawing appears. An applet that isn't running keeps
 * its last state, dimmed, and a press starts it.
 */

import type { ControlKind as AppletControlKind } from "@dashi/applet";
import type { TileSize } from "./layout.ts";

/** What a press on an applet's tile asks of it. */
export type TileAction =
  | { kind: "toggle"; on: boolean }
  | { kind: "press" }
  | { kind: "choose"; choice: string }
  | { kind: "set"; value: number }
  | { kind: "open" };

export interface AppletTile {
  /** `applet:<applet id>/<control id>`: its id in the layout. */
  key: string;
  appletId: string;
  /** The applet's name, under the control's in Add. */
  appletName: string;
  kind: AppletControlKind;
  title: string;
  sizes: readonly TileSize[];
  /** SVG markup, tinted by Dashi. */
  glyph: string;
  on: boolean;
  /** The second line ("Bounce", "71 °C · 3,400 rpm"). */
  detail: string | null;
  /** A choice control's choices and the one chosen. */
  choices: readonly string[];
  choice: string | null;
  /** A slider's range and value. */
  min: number;
  max: number;
  value: number | null;
  /** The applet is connected; when not, its tile is dimmed and a press starts it. */
  running: boolean;
}

export interface AppletTileSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly AppletTile[];
  /** A press on a tile: sent to the applet, or the applet started when it isn't running. */
  act(key: string, action: TileAction): void;
}

/** `applet:<applet id>/<control id>`. */
export const appletTileKey = (appletId: string, controlId: string): string => `applet:${appletId}/${controlId}`;

export const isAppletTile = (id: string): boolean => id.startsWith("applet:");

/** A slider's value as a share of its range. */
export const levelOf = (tile: Pick<AppletTile, "min" | "max" | "value">): number =>
  tile.value === null || tile.max <= tile.min ? 0 : Math.min(Math.max((tile.value - tile.min) / (tile.max - tile.min), 0), 1);

/** A share of a slider's range as its value, on the step (whole numbers unless the range is under 10). */
export function valueAt(tile: Pick<AppletTile, "min" | "max">, level: number): number {
  const raw = tile.min + Math.min(Math.max(level, 0), 1) * (tile.max - tile.min);
  return tile.max - tile.min >= 10 ? Math.round(raw) : Math.round(raw * 10) / 10;
}

/** The choice after the current one, round: a choice tile's knob steps through them. */
export function nextChoice(tile: Pick<AppletTile, "choices" | "choice">): string | null {
  if (tile.choices.length === 0) return null;
  const at = tile.choice === null ? -1 : tile.choices.indexOf(tile.choice);
  return tile.choices[(at + 1) % tile.choices.length] ?? null;
}
