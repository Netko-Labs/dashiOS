/**
 * The launcher finds Settings panes as Spotlight does: "display" opens
 * Displays, "wifi" Network. One entry per pane in the sidebar, named by its
 * title, drawn with the glyph the sidebar draws, with a few words on what it
 * holds and the other words people look for it by. "settings" finds a pane
 * only when nothing else answers to it: that word means System Settings.
 */

import { type App, iconPath, registerShellEntry, SETTINGS_APP_ID, type ShellEntryLook } from "../apps.ts";
import { PANES, type PaneId, type PaneInfo } from "./panes.ts";

/** Other words for each pane, lowercase; panes not listed answer to their title only. */
export const PANE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  appearance: ["dark mode", "light mode", "theme", "accent", "corners", "reduce motion", "highlight", "active window", "focus ring"],
  wallpaper: ["background", "desktop picture", "live wallpaper"],
  displays: ["display", "monitor", "screen", "resolution", "scale", "refresh rate", "rotation", "arrangement"],
  "desktop-dock": ["dock", "taskbar", "autohide", "spaces", "desktops", "full screen", "fullscreen", "full-screen apps", "games"],
  keyboard: ["layout", "input source", "key repeat", "shortcuts"],
  trackpad: ["touchpad", "tap to click", "natural scrolling", "gestures", "scrolling speed"],
  mouse: ["pointer", "tracking speed", "scrolling speed"],
  "date-time": ["clock", "time zone", "timezone", "24-hour", "ntp"],
  "language-region": ["language", "locale", "region", "formats", "first day of week"],
  "lock-screen": ["lock", "screen saver", "display off", "sleep"],
  notifications: ["do not disturb", "banners", "alerts"],
  passwords: ["vault", "passkeys", "api keys", "tokens", "1password"],
  agents: ["ai", "mcp", "permissions", "privacy"],
  about: ["version", "system information", "hardware"],
  network: ["wifi", "wi-fi", "ethernet", "internet", "vpn", "ip address"],
  bluetooth: ["headphones", "pairing", "devices"],
  sound: ["volume", "audio", "speakers", "microphone", "output", "input"],
  battery: ["power", "energy", "low power mode", "battery percentage"],
  users: ["account", "password", "avatar", "login", "automatic login"],
};

/** What each pane holds, in a few words after its name on the launcher's row (VS-2: the same line). */
export const PANE_DETAILS: Readonly<Record<PaneId, string>> = {
  appearance: "Dark Mode, accent, corners",
  wallpaper: "desktop picture",
  displays: "resolution, scale, arrangement",
  "desktop-dock": "Dock, Desktops, full screen",
  keyboard: "layout, key repeat, shortcuts",
  trackpad: "tap to click, gestures",
  mouse: "tracking and scrolling speed",
  "date-time": "clock, time zone",
  "language-region": "language, formats",
  "lock-screen": "screen saver, sleep",
  notifications: "Do Not Disturb, banners",
  passwords: "saved passwords and codes",
  agents: "what agents may do",
  about: "version and hardware",
  network: "Wi-Fi, Ethernet, VPN",
  bluetooth: "devices, pairing",
  sound: "volume, output, input",
  battery: "power modes, energy",
  graphics: "graphics cards",
  users: "accounts, login",
};

/** The launcher entry for `pane`. */
export function paneEntry(pane: { id: string; title: string }): App {
  return { id: `${SETTINGS_APP_ID}/${pane.id}`, name: pane.title, icon: iconPath("settings") };
}

/** The words `pane` answers to: its id's words and its own keywords ("settings" is only a fallback: `paneLook`). */
export function paneKeywords(pane: { id: string; title: string }): string[] {
  return [...new Set([...pane.id.split("-"), ...(PANE_KEYWORDS[pane.id] ?? [])])];
}

/** How the launcher draws `pane`: its sidebar glyph and what it holds; "settings" finds it only when nothing else matches. */
export function paneLook(pane: Pick<PaneInfo, "id" | "glyph">): ShellEntryLook {
  return { glyph: pane.glyph, detail: PANE_DETAILS[pane.id], fallbackKeywords: ["settings"] };
}

/** Put every pane in the launcher, opening Settings there; returns what takes them back. */
export function registerPaneEntries(open: (pane: PaneId) => void): () => void {
  const undo = PANES.map((pane) => registerShellEntry(paneEntry(pane), paneKeywords(pane), () => open(pane.id), paneLook(pane)));
  return () => {
    for (const each of undo) each();
  };
}
