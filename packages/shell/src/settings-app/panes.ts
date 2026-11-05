/**
 * The panes in the sidebar, in order. Pure data: which pane a row opens, how
 * it is drawn, and which gap of the sidebar it sits under.
 */

import { INFO } from "@dashi/ui";
import { CONTRAST, LOCK } from "../control-center/glyphs.ts";
import { BELL, CLOCK, DISPLAY, DOCK_GLYPH, GLOBE, KEYBOARD, MOUSE, PICTURE, SPARKLE, TRACKPAD } from "./glyphs.ts";
import { BATTERY, BLUETOOTH, NETWORK, PERSON, SPEAKER } from "./glyphs-machine.ts";

export type PaneId =
  | "appearance"
  | "wallpaper"
  | "displays"
  | "desktop-dock"
  | "keyboard"
  | "trackpad"
  | "mouse"
  | "date-time"
  | "language-region"
  | "lock-screen"
  | "notifications"
  | "passwords"
  | "agents"
  | "about"
  | "network"
  | "bluetooth"
  | "sound"
  | "battery"
  | "users";

export interface PaneInfo {
  id: PaneId;
  title: string;
  glyph: string;
  /** The color of the row's icon tile. */
  tint: string;
  /** Rows of one group sit together; a gap separates groups. */
  group: number;
}

export const PANES: readonly PaneInfo[] = [
  { id: "appearance", title: "Appearance", glyph: CONTRAST, tint: "#5e5ce6", group: 0 },
  { id: "wallpaper", title: "Wallpaper", glyph: PICTURE, tint: "#30b0c7", group: 0 },
  { id: "displays", title: "Displays", glyph: DISPLAY, tint: "#0a84ff", group: 0 },
  { id: "desktop-dock", title: "Desktop & Dock", glyph: DOCK_GLYPH, tint: "#32ade6", group: 0 },
  { id: "network", title: "Network", glyph: NETWORK, tint: "#0a84ff", group: 10 },
  { id: "bluetooth", title: "Bluetooth", glyph: BLUETOOTH, tint: "#0a84ff", group: 10 },
  { id: "sound", title: "Sound", glyph: SPEAKER, tint: "#ff375f", group: 10 },
  { id: "battery", title: "Battery & Power", glyph: BATTERY, tint: "#30d158", group: 10 },
  { id: "keyboard", title: "Keyboard", glyph: KEYBOARD, tint: "#8e8e93", group: 1 },
  { id: "trackpad", title: "Trackpad", glyph: TRACKPAD, tint: "#8e8e93", group: 1 },
  { id: "mouse", title: "Mouse", glyph: MOUSE, tint: "#8e8e93", group: 1 },
  { id: "date-time", title: "Date & Time", glyph: CLOCK, tint: "#ff9f0a", group: 2 },
  { id: "language-region", title: "Language & Region", glyph: GLOBE, tint: "#0a84ff", group: 2 },
  { id: "lock-screen", title: "Lock Screen", glyph: LOCK, tint: "#636366", group: 2 },
  { id: "users", title: "Users & Accounts", glyph: PERSON, tint: "#8e8e93", group: 2 },
  { id: "notifications", title: "Notifications", glyph: BELL, tint: "#ff453a", group: 2 },
  { id: "passwords", title: "Passwords", glyph: LOCK, tint: "#a2845e", group: 2 },
  { id: "agents", title: "Agents", glyph: SPARKLE, tint: "#6E56CF", group: 2 },
  { id: "about", title: "About", glyph: INFO, tint: "#8e8e93", group: 3 },
];

export const FIRST_PANE: PaneId = "appearance";

export function isPaneId(value: unknown): value is PaneId {
  return PANES.some((pane) => pane.id === value);
}

/** A pane's title, the heading of its page or the toolbar's text. */
export function paneTitle(id: PaneId): string {
  return PANES.find((pane) => pane.id === id)?.title ?? "";
}

/** The sidebar as groups of panes. */
export function paneGroups(panes: readonly PaneInfo[] = PANES): PaneInfo[][] {
  const groups: PaneInfo[][] = [];
  for (const pane of panes) {
    const last = groups.at(-1);
    if (last && last[0]?.group === pane.group) last.push(pane);
    else groups.push([pane]);
  }
  return groups;
}

/** Which pane is showing; `open` can switch it from outside (the menu, an agent). */
export class Nav {
  private current: PaneId = FIRST_PANE;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PaneId => this.current;

  select(pane: PaneId): void {
    if (pane === this.current) return;
    this.current = pane;
    for (const listener of this.listeners) listener();
  }
}
