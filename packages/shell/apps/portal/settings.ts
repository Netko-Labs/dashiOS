/**
 * The portal's Settings (org.freedesktop.impl.portal.Settings, version 2):
 * what apps read about the desktop's look, from Dashi's own settings, not
 * read back from gsettings. `org.freedesktop.appearance` (color scheme,
 * accent, contrast, reduced motion) for every toolkit, and the
 * `org.gnome.desktop.interface` and `wm.preferences` keys GTK reads when it
 * is sandboxed or told to ask the portal (GTK_USE_PORTAL, GDK_DEBUG=portals).
 * The sources are Control Center's Dark Mode (control-center.json) and
 * settings.json's appearance; a change to either is sent as SettingChanged,
 * key by key.
 */

import { ACCENT, type AppLook, gtkThemeName, INTERFACE_FONT, WINDOW_BUTTONS } from "../../src/shared/appearance/index.ts";
import { DBusError, type InterfaceSpec, type Variant, variant } from "../../src/shared/dbus/index.ts";

export const SETTINGS = "org.freedesktop.impl.portal.Settings";
export const NOT_FOUND = "org.freedesktop.portal.Error.NotFound";

/** What the values are made from. */
export interface LookState {
  dark: boolean;
  reduceMotion: boolean;
  pointerSize: number;
  look: AppLook;
}

export type SettingsTable = Map<string, Map<string, Variant>>;

/** `#rrggbb` as the portal's accent: three doubles from 0 to 1; null for anything else. */
export function accentTriple(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return null;
  return [match[1], match[2], match[3]].map((part) => Math.round((Number.parseInt(part as string, 16) / 255) * 1000) / 1000) as [number, number, number];
}

export function settingsTable(state: LookState): SettingsTable {
  const accent = accentTriple(ACCENT);
  const appearance = new Map<string, Variant>([
    // 1 prefer dark; light is Dashi's default look, which the portal calls "no preference" (0), as GNOME does.
    ["color-scheme", variant("u", state.dark ? 1 : 0)],
    ["contrast", variant("u", 0)],
    ["reduced-motion", variant("u", state.reduceMotion ? 1 : 0)],
  ]);
  if (accent) appearance.set("accent-color", variant("(ddd)", accent));
  const gnome = new Map<string, Variant>([
    ["color-scheme", variant("s", state.dark ? "prefer-dark" : "default")],
    ["gtk-theme", variant("s", gtkThemeName(state.dark, state.look.adwGtk3 === true))],
    ["cursor-size", variant("i", state.pointerSize)],
    ["enable-animations", variant("b", !state.reduceMotion)],
    ["text-scaling-factor", variant("d", 1)],
  ]);
  if (state.look.accent) gnome.set("accent-color", variant("s", state.look.accent));
  if (state.look.interFont) {
    gnome.set("font-name", variant("s", INTERFACE_FONT));
    gnome.set("document-font-name", variant("s", INTERFACE_FONT));
  }
  return new Map([
    ["org.freedesktop.appearance", appearance],
    ["org.gnome.desktop.interface", gnome],
    ["org.gnome.desktop.wm.preferences", new Map([["button-layout", variant("s", WINDOW_BUTTONS)]])],
  ]);
}

/** Whether `namespace` is one ReadAll asked for: an exact name, or a prefix ending in `*`; no patterns means every one. */
export function namespaceWanted(namespace: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0 || patterns.includes("")) return true;
  return patterns.some((pattern) => (pattern.endsWith("*") ? namespace.startsWith(pattern.slice(0, -1)) : namespace === pattern));
}

/** What `ReadAll(patterns)` answers. */
export function readAll(table: SettingsTable, patterns: readonly string[]): SettingsTable {
  return new Map([...table].filter(([namespace]) => namespaceWanted(namespace, patterns)));
}

const sameValue = (a: Variant, b: Variant): boolean => a.signature === b.signature && JSON.stringify(a.value) === JSON.stringify(b.value);

/** The keys whose values differ between two tables (and keys that appeared), for SettingChanged. */
export function changedSettings(before: SettingsTable, after: SettingsTable): Array<[string, string, Variant]> {
  const changes: Array<[string, string, Variant]> = [];
  for (const [namespace, keys] of after) {
    for (const [key, value] of keys) {
      const old = before.get(namespace)?.get(key);
      if (!old || !sameValue(old, value)) changes.push([namespace, key, value]);
    }
  }
  return changes;
}

export function settingsInterface(current: () => SettingsTable): InterfaceSpec {
  return {
    name: SETTINGS,
    methods: {
      ReadAll: {
        in: "as",
        out: "a{sa{sv}}",
        handler: ([patterns]) => readAll(current(), Array.isArray(patterns) ? patterns.filter((p): p is string => typeof p === "string") : []),
      },
      Read: {
        in: "ss",
        out: "v",
        handler: ([namespace, key]) => {
          const value = current().get(String(namespace))?.get(String(key));
          if (!value) throw new DBusError(NOT_FOUND, "no such setting");
          return value;
        },
      },
    },
    signals: { SettingChanged: "ssv" },
    properties: { version: { type: "u", get: () => 2 } },
  };
}
