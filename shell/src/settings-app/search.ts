/**
 * The launcher finds Settings panes as Spotlight does: "display" opens
 * Displays, "wifi" Network. One entry per pane in the sidebar, named by its
 * title, with the other words people look for it by.
 */

import { type App, iconPath, registerShellEntry, SETTINGS_APP_ID } from "../apps.ts";
import { PANES, type PaneId } from "./panes.ts";

/** Other words for each pane, lowercase; panes not listed answer to their title only. */
export const PANE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  appearance: ["dark mode", "light mode", "theme", "accent", "corners", "reduce motion"],
  wallpaper: ["background", "desktop picture", "live wallpaper"],
  displays: ["display", "monitor", "screen", "resolution", "scale", "refresh rate", "rotation", "arrangement"],
  "desktop-dock": ["dock", "taskbar", "autohide", "spaces", "desktops"],
  keyboard: ["layout", "input source", "key repeat", "shortcuts"],
  trackpad: ["touchpad", "tap to click", "natural scrolling", "gestures", "scrolling speed"],
  mouse: ["pointer", "tracking speed", "scrolling speed"],
  "date-time": ["clock", "time zone", "timezone", "24-hour", "ntp"],
  "language-region": ["language", "locale", "region", "formats", "first day of week"],
  "lock-screen": ["lock", "screen saver", "display off", "sleep"],
  notifications: ["do not disturb", "banners", "alerts"],
  agents: ["ai", "mcp", "permissions", "privacy"],
  about: ["version", "system information", "hardware"],
  network: ["wifi", "wi-fi", "ethernet", "internet", "vpn", "ip address"],
  bluetooth: ["headphones", "pairing", "devices"],
  sound: ["volume", "audio", "speakers", "microphone", "output", "input"],
  battery: ["power", "energy", "low power mode", "battery percentage"],
  users: ["account", "password", "avatar", "login", "automatic login"],
};

/** The launcher entry for `pane`. */
export function paneEntry(pane: { id: string; title: string }): App {
  return { id: `${SETTINGS_APP_ID}/${pane.id}`, name: pane.title, icon: iconPath("settings") };
}

/** The words `pane` answers to: its id's words, its own keywords, and "settings". */
export function paneKeywords(pane: { id: string; title: string }): string[] {
  return [...new Set([...pane.id.split("-"), ...(PANE_KEYWORDS[pane.id] ?? []), "settings"])];
}

/** Put every pane in the launcher, opening Settings there; returns what takes them back. */
export function registerPaneEntries(open: (pane: PaneId) => void): () => void {
  const undo = PANES.map((pane) => registerShellEntry(paneEntry(pane), paneKeywords(pane), () => open(pane.id)));
  return () => {
    for (const each of undo) each();
  };
}
