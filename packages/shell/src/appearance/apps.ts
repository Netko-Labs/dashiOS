/**
 * Dark Mode for other people's apps. Dashi paints its own surfaces from the
 * palette (theme.ts); GTK, libadwaita, Chromium (Helium), and Qt 6.5+ apps
 * learn the preference through the settings that xdg-desktop-portal serves as
 * `org.freedesktop.appearance color-scheme`, and KDE apps read kdeglobals.
 * This file only decides which commands to run and whether it is safe to run
 * them; nothing here touches the system.
 */

import { COMPOSITOR, findAncestor, isNested } from "../menus/index.ts";
import { type AppLook, gtkThemeName, INTERFACE_FONT, WINDOW_BUTTONS } from "../shared/appearance/index.ts";

/** One program and its arguments; never a shell string. */
export type AppCommand = readonly string[];

/**
 * The commands that make installed apps follow `dark`, for the tools that are
 * present (`has`). Order matters little, but the portal's own key goes first.
 */
export function appThemeCommands(dark: boolean, has: (program: string) => boolean, look: AppLook = {}): AppCommand[] {
  const commands: AppCommand[] = [];
  if (has("gsettings")) {
    const interfaceKey = (key: string, value: string): AppCommand => ["gsettings", "set", "org.gnome.desktop.interface", key, value];
    // libadwaita, GTK 4, Chromium, and the portal clients read this.
    commands.push(interfaceKey("color-scheme", dark ? "prefer-dark" : "default"));
    // GTK 3 apps ignore the scheme and want a dark theme by name.
    commands.push(interfaceKey("gtk-theme", gtkThemeName(dark, look.adwGtk3 === true)));
    // The same accent the CSS paints, for apps that ask the portal for it.
    if (look.accent) commands.push(interfaceKey("accent-color", look.accent));
    // Dashi's UI font; the monospace font stays the system's.
    if (look.interFont) {
      commands.push(interfaceKey("font-name", INTERFACE_FONT));
      commands.push(interfaceKey("document-font-name", INTERFACE_FONT));
    }
    // Apps that draw their own title bars (GTK headerbars, Chromium)
    // put close, minimize, and zoom on the left, in Dashi's order.
    commands.push(["gsettings", "set", "org.gnome.desktop.wm.preferences", "button-layout", WINDOW_BUTTONS]);
  }
  // Plasma's tool writes kdeglobals and tells running KDE apps; absent without Plasma.
  if (has("plasma-apply-colorscheme")) commands.push(["plasma-apply-colorscheme", dark ? "BreezeDark" : "BreezeLight"]);
  // Flatpak apps are sandboxed away from ~/.config, where Dashi's GTK block
  // lives (gtk-css.ts: window buttons, colors); let them read those two
  // folders, as desktops that theme flatpaks do. Read-only, and idempotent.
  if (has("flatpak")) commands.push(["flatpak", "override", "--user", "--filesystem=xdg-config/gtk-4.0:ro", "--filesystem=xdg-config/gtk-3.0:ro"]);
  return commands;
}

/** Whether the shell may change the settings apps read, and if not, why not. */
export type Gate = { on: true } | { on: false; why: string };

export interface GateInput {
  env: Readonly<Record<string, string | undefined>>;
  /** dashi-comp's environment (/proc/<pid>/environ), or null if it could not be found or read. */
  compositorEnviron: string | null;
}

/**
 * These commands change the user's settings, so they run only in a real
 * Dashi session. Inside another desktop (a development window: the
 * compositor was started with that desktop's WAYLAND_DISPLAY or DISPLAY) the
 * settings are the developer's own and are left alone, and so is a shell whose
 * compositor cannot be found (run by hand under some other desktop).
 * `DASHI_APP_APPEARANCE=0` always turns it off; `=1` turns it on anywhere
 * with a session bus. With no session bus (`DBUS_SESSION_BUS_ADDRESS=disabled:`,
 * how development runs are started) there is no one to tell.
 */
export function appThemeGate({ env, compositorEnviron }: GateInput): Gate {
  if (env.DASHI_APP_APPEARANCE === "0") return { on: false, why: "DASHI_APP_APPEARANCE=0" };
  if (env.DBUS_SESSION_BUS_ADDRESS?.startsWith("disabled:")) return { on: false, why: "no session bus" };
  if (env.DASHI_APP_APPEARANCE === "1") return { on: true };
  if (compositorEnviron === null) return { on: false, why: "no dashi-comp above the shell" };
  if (isNested(compositorEnviron)) return { on: false, why: "running inside another desktop" };
  return { on: true };
}

/** dashi-comp's environment, found by walking up from this process; null when it cannot be read. */
export function readCompositorEnviron(read: (path: string) => string | null, start = process.pid): string | null {
  const pid = findAncestor(COMPOSITOR, start, (parent) => read(`/proc/${parent}/stat`));
  return pid === null ? null : read(`/proc/${pid}/environ`);
}
