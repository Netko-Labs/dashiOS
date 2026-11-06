/**
 * The panes in the sidebar, in order. Pure data: which pane a row opens, how
 * it is drawn, and which gap of the sidebar it sits under.
 */

import { INFO, lightColors, TINTS } from "@dashi/ui";
import { CONTRAST, LOCK } from "../control-center/glyphs.ts";
import { graphicsGlyph } from "../laptop/glyphs.ts";
import { BELL, CLOCK, DISPLAY, DOCK_GLYPH, GLOBE, KEY, KEYBOARD, MOUSE, PICTURE, SPARKLE, TRACKPAD } from "./glyphs.ts";
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
  | "graphics"
  | "users";

export interface PaneInfo {
  id: PaneId;
  title: string;
  glyph: string;
  /** The color of the row's icon tile. */
  tint: string;
  /** Rows of one group sit together; a gap separates groups. */
  group: number;
  /** Listed only when the machine has it (the sidebar is told which: view.tsx). */
  optional?: true;
  /** Agents' pictures blank the window while it shows (agents/secrets/vault-view.ts): Settings never reopens on it. */
  private?: true;
}

/**
 * Tiles take Dashi's tints (docs/design.html, "Tints"), never a job color:
 * Agents alone wears shiso, because it is about agents, and no tile is ume.
 */
export const PANES: readonly PaneInfo[] = [
  { id: "appearance", title: "Appearance", glyph: CONTRAST, tint: TINTS.nori, group: 0 },
  { id: "wallpaper", title: "Wallpaper", glyph: PICTURE, tint: TINTS.wakame, group: 0 },
  { id: "displays", title: "Displays", glyph: DISPLAY, tint: TINTS.mizu, group: 0 },
  { id: "desktop-dock", title: "Desktop & Dock", glyph: DOCK_GLYPH, tint: TINTS.wakame, group: 0 },
  { id: "network", title: "Network", glyph: NETWORK, tint: TINTS.mizu, group: 10 },
  { id: "bluetooth", title: "Bluetooth", glyph: BLUETOOTH, tint: TINTS.mizu, group: 10 },
  { id: "sound", title: "Sound", glyph: SPEAKER, tint: TINTS.kabocha, group: 10 },
  { id: "battery", title: "Battery & Power", glyph: BATTERY, tint: TINTS.matcha, group: 10 },
  { id: "graphics", title: "Graphics", glyph: graphicsGlyph(), tint: TINTS.nori, group: 10, optional: true },
  { id: "keyboard", title: "Keyboard", glyph: KEYBOARD, tint: TINTS.goma, group: 1 },
  { id: "trackpad", title: "Trackpad", glyph: TRACKPAD, tint: TINTS.goma, group: 1 },
  { id: "mouse", title: "Mouse", glyph: MOUSE, tint: TINTS.goma, group: 1 },
  { id: "date-time", title: "Date & Time", glyph: CLOCK, tint: TINTS.miso, group: 2 },
  { id: "language-region", title: "Language & Region", glyph: GLOBE, tint: TINTS.mizu, group: 2 },
  { id: "lock-screen", title: "Lock Screen", glyph: LOCK, tint: TINTS.goma, group: 2 },
  { id: "users", title: "Users & Accounts", glyph: PERSON, tint: TINTS.goma, group: 2 },
  { id: "notifications", title: "Notifications", glyph: BELL, tint: TINTS.kabocha, group: 2 },
  { id: "passwords", title: "Passwords", glyph: KEY, tint: TINTS.shiitake, group: 2, private: true },
  { id: "agents", title: "Agents", glyph: SPARKLE, tint: lightColors.agent, group: 2 },
  { id: "about", title: "About", glyph: INFO, tint: TINTS.goma, group: 3 },
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
