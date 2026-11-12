/**
 * The panes in the sidebar, in order. Pure data: which pane a row opens, its
 * glyph on the row's knob, and the group it sits in (docs/design.html,
 * "Settings": the look of the desktop first, then three plain labels).
 */

import {
  BATTERY,
  BELL,
  BLUETOOTH,
  CLOCK,
  CONTRAST,
  DISPLAY,
  DOCK,
  GLOBE,
  GPU,
  GRID,
  HISTORY,
  IMAGE,
  INFO,
  KEY,
  KEYBOARD,
  LOCK,
  MIC,
  MOUSE,
  SHIELD,
  SPARK,
  TRACKPAD,
  USER,
  VOLUME,
  WIFI,
} from "./knob-glyphs.ts";

export type PaneId =
  | "recent"
  | "appearance"
  | "wallpaper"
  | "displays"
  | "desktop-dock"
  | "control-center"
  | "keyboard"
  | "trackpad"
  | "mouse"
  | "date-time"
  | "language-region"
  | "lock-screen"
  | "notifications"
  | "passwords"
  | "agents"
  | "voice"
  | "privacy"
  | "about"
  | "network"
  | "bluetooth"
  | "sound"
  | "battery"
  | "graphics"
  | "users";

/** The sidebar's groups: the desktop's look (no label), then Connect, This laptop, and You. */
export type PaneGroup = "look" | "connect" | "laptop" | "you";

/** Each group's label over its panes; the first has none. */
export const GROUP_LABELS: Readonly<Record<PaneGroup, string | null>> = { look: null, connect: "Connect", laptop: "This laptop", you: "You" };

export interface PaneInfo {
  id: PaneId;
  title: string;
  /** The glyph on its knob in the sidebar, and on its row in the launcher. */
  glyph: string;
  group: PaneGroup;
  /** Listed only when the machine has it (the sidebar is told which: view.tsx). */
  optional?: true;
  /** Agents' pictures blank the window while it shows (agents/secrets/vault-view.ts): Settings never reopens on it. */
  private?: true;
}

/**
 * As the approved design lists them: Appearance to Control Center, then
 * Connect (Wi-Fi, Bluetooth, Sound), This laptop (Battery & Power, Graphics,
 * Keyboard, Trackpad), You (Users, Passwords, Agents, Privacy). The panes it
 * didn't draw join the group they belong to, after the drawn ones:
 * Notifications with the desktop, Mouse and About with the laptop, Lock
 * Screen, Date & Time, Language & Region and Recently changed with you.
 */
export const PANES: readonly PaneInfo[] = [
  { id: "appearance", title: "Appearance", glyph: CONTRAST, group: "look" },
  { id: "wallpaper", title: "Wallpaper", glyph: IMAGE, group: "look" },
  { id: "displays", title: "Displays", glyph: DISPLAY, group: "look" },
  { id: "desktop-dock", title: "Desktop & Dock", glyph: DOCK, group: "look" },
  { id: "control-center", title: "Control Center", glyph: GRID, group: "look" },
  { id: "notifications", title: "Notifications", glyph: BELL, group: "look" },
  { id: "network", title: "Wi-Fi", glyph: WIFI, group: "connect" },
  { id: "bluetooth", title: "Bluetooth", glyph: BLUETOOTH, group: "connect" },
  { id: "sound", title: "Sound", glyph: VOLUME, group: "connect" },
  { id: "battery", title: "Battery & Power", glyph: BATTERY, group: "laptop" },
  { id: "graphics", title: "Graphics", glyph: GPU, group: "laptop", optional: true },
  { id: "keyboard", title: "Keyboard", glyph: KEYBOARD, group: "laptop" },
  { id: "trackpad", title: "Trackpad", glyph: TRACKPAD, group: "laptop" },
  { id: "mouse", title: "Mouse", glyph: MOUSE, group: "laptop" },
  { id: "about", title: "About", glyph: INFO, group: "laptop" },
  { id: "users", title: "Users", glyph: USER, group: "you" },
  { id: "passwords", title: "Passwords", glyph: KEY, group: "you", private: true },
  { id: "agents", title: "Agents", glyph: SPARK, group: "you" },
  { id: "privacy", title: "Privacy", glyph: SHIELD, group: "you" },
  { id: "voice", title: "Voice", glyph: MIC, group: "you" },
  { id: "lock-screen", title: "Lock Screen", glyph: LOCK, group: "you" },
  { id: "date-time", title: "Date & Time", glyph: CLOCK, group: "you" },
  { id: "language-region", title: "Language & Region", glyph: GLOBE, group: "you" },
  { id: "recent", title: "Recently changed", glyph: HISTORY, group: "you" },
];

export const FIRST_PANE: PaneId = "appearance";

export function isPaneId(value: unknown): value is PaneId {
  return PANES.some((pane) => pane.id === value);
}

/** Whether a pane's window is blanked in agents' pictures while it shows (Passwords). */
export function isPrivatePane(id: PaneId): boolean {
  return PANES.some((pane) => pane.id === id && pane.private === true);
}

/** A pane's title, the heading of its page or the toolbar's text. */
export function paneTitle(id: PaneId): string {
  return PANES.find((pane) => pane.id === id)?.title ?? "";
}

/** Every pane is in the sidebar. */
export const SIDEBAR_PANES: readonly PaneInfo[] = PANES;

export interface SidebarGroup {
  group: PaneGroup;
  /** Its label; null for the first. */
  label: string | null;
  panes: PaneInfo[];
}

/** The sidebar as its groups, in order, each with its label; a group with no panes shown is left out. */
export function paneGroups(panes: readonly PaneInfo[] = SIDEBAR_PANES): SidebarGroup[] {
  const groups: SidebarGroup[] = [];
  for (const pane of panes) {
    const last = groups.at(-1);
    if (last && last.group === pane.group) last.panes.push(pane);
    else groups.push({ group: pane.group, label: GROUP_LABELS[pane.group], panes: [pane] });
  }
  return groups;
}

/**
 * Which pane is showing; `open` can switch it from outside (the menu, an agent).
 * It outlives the window: Settings reopens on the last pane, unless that pane
 * is private, then on the last one that wasn't (`reopen`), else Appearance.
 */
export class Nav {
  private current: PaneId = FIRST_PANE;
  private lastPublic: PaneId = FIRST_PANE;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PaneId => this.current;

  select(pane: PaneId): void {
    if (!isPrivatePane(pane)) this.lastPublic = pane;
    if (pane === this.current) return;
    this.current = pane;
    for (const listener of this.listeners) listener();
  }

  /** The window opens again with no pane asked for: never straight onto a private one. */
  reopen(): void {
    if (isPrivatePane(this.current)) this.select(this.lastPublic);
  }
}
