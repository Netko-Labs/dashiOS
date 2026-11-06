/**
 * Settings as actions. Every pane is at `dashi://settings/<pane>`, and every
 * setting the agents' `set_setting` knows is a row of its own, at the
 * address of its row in the pane (`dashi://settings/appearance/dark-mode`):
 * a toggle with its state, or a pick of values. Changing one runs the same
 * `set_setting` call an agent makes, as the person, so the launcher's
 * switch, a key, a link, and an agent are one change with one set of checks.
 * Other rows search finds by name ("text size") are addresses too
 * (`SPOT_ROWS`): choosing one opens Settings at it.
 *
 * A settings address with no arguments, from a link, opens the pane at the
 * row and lights it up (`place`); with `?value=…` it sets it.
 */

import type { Desktop } from "../../agents/desktop/types.ts";
import { parseCall } from "../../agents/tools/registry.ts";
import type { SettingName } from "../../agents/tools/types.ts";
import { CORNER_NAMES } from "../../corners.ts";
import { DOCK_STYLES } from "../../dock/settings.ts";
import { SCROLL_SPEED_MAX, SCROLL_SPEED_MIN } from "../../scroll-speed.ts";
import { PANES } from "../../settings-app/panes.ts";
import { PANE_KEYWORDS } from "../../settings-app/search.ts";
import { formatAddress } from "../address.ts";
import { type ActionContext, type ActionDef, type ActionKind, type ActionState, failed, invalid, type Outcome, ok, ready } from "../types.ts";

/** Every name `set_setting` takes. */
export type SettingKey =
  | SettingName
  | "dock_autohide"
  | "dock_style"
  | "trackpad_scroll_speed"
  | "mouse_scroll_speed"
  | "battery_percentage"
  | "sound_in_menu_bar";

export interface SettingRow {
  setting: SettingKey;
  pane: string;
  /** The row's id in its pane: the last part of its address, and what Settings lights up (settings-app/spot.tsx). */
  row: string;
  /** As the pane's row says it. */
  title: string;
  kind: ActionKind;
  /** The value's schema, for a pick or a number. */
  value?: Record<string, unknown>;
  words: readonly string[];
}

/** The rows, in the order of the panes. */
export const SETTING_ROWS: readonly SettingRow[] = [
  { setting: "dark_mode", pane: "appearance", row: "dark-mode", title: "Dark Mode", kind: "toggle", words: ["dark", "light mode", "theme", "night mode"] },
  {
    setting: "window_corners",
    pane: "appearance",
    row: "window-corners",
    title: "Window corners",
    kind: "pick",
    value: { type: "string", enum: [...CORNER_NAMES] },
    words: ["corners", "round", "radius"],
  },
  { setting: "night_shift", pane: "displays", row: "night-shift", title: "Night Shift", kind: "toggle", words: ["warm", "blue light", "night"] },
  {
    setting: "dock_style",
    pane: "desktop-dock",
    row: "style",
    title: "Dock style",
    kind: "pick",
    value: { type: "string", enum: [...DOCK_STYLES] },
    words: ["dock", "taskbar"],
  },
  {
    setting: "dock_autohide",
    pane: "desktop-dock",
    row: "autohide",
    title: "Automatically hide and show the Dock",
    kind: "toggle",
    words: ["dock", "autohide", "hide dock"],
  },
  {
    setting: "trackpad_scroll_speed",
    pane: "trackpad",
    row: "scrolling-speed",
    title: "Trackpad scrolling speed",
    kind: "pick",
    value: { type: "number", minimum: SCROLL_SPEED_MIN, maximum: SCROLL_SPEED_MAX },
    words: ["touchpad", "scroll", "scrolling"],
  },
  {
    setting: "mouse_scroll_speed",
    pane: "mouse",
    row: "scrolling-speed",
    title: "Mouse scrolling speed",
    kind: "pick",
    value: { type: "number", minimum: SCROLL_SPEED_MIN, maximum: SCROLL_SPEED_MAX },
    words: ["wheel", "scroll", "scrolling"],
  },
  {
    setting: "do_not_disturb",
    pane: "notifications",
    row: "do-not-disturb",
    title: "Do Not Disturb",
    kind: "toggle",
    words: ["dnd", "focus", "quiet", "banners"],
  },
  { setting: "sound_in_menu_bar", pane: "sound", row: "show-in-menu-bar", title: "Show Sound in menu bar", kind: "toggle", words: ["speaker", "volume icon"] },
  {
    setting: "battery_percentage",
    pane: "battery",
    row: "battery-percentage",
    title: "Show battery percentage in menu bar",
    kind: "toggle",
    words: ["battery percentage", "battery", "percent"],
  },
];

/**
 * A row search finds by name that `set_setting` doesn't take ("text size"):
 * the launcher lists it as a Settings row, and choosing it opens Settings
 * scrolled to the row and lit, as a link to it does (spot.tsx). A word that
 * names a row belongs here rather than only among its pane's keywords, so
 * the search lands on the row, not the top of the pane.
 */
export interface SpotRow {
  pane: string;
  /** The row's id in its pane (its `<Spot row>`). */
  row: string;
  /** As the pane's row says it. */
  title: string;
  words: readonly string[];
}

export const SPOT_ROWS: readonly SpotRow[] = [
  { pane: "appearance", row: "accent-color", title: "Accent color", words: ["accent", "highlight color"] },
  { pane: "appearance", row: "highlight-active-window", title: "Highlight the active window", words: ["active window", "focus ring", "highlight"] },
  { pane: "appearance", row: "pointer-size", title: "Pointer size", words: ["cursor size", "bigger pointer", "larger pointer", "cursor"] },
  { pane: "appearance", row: "text-size", title: "Text size", words: ["font size", "bigger text", "larger text", "smaller text"] },
  { pane: "appearance", row: "reduce-motion", title: "Reduce motion", words: ["animations", "motion"] },
  {
    pane: "desktop-dock",
    row: "full-screen-desktop",
    title: "Give full-screen apps their own desktop",
    words: ["full screen", "fullscreen", "full-screen apps", "games"],
  },
  { pane: "keyboard", row: "key-repeat", title: "Key repeat rate", words: ["key repeat", "repeat delay", "delay until repeat"] },
  { pane: "keyboard", row: "input-method", title: "Input method", words: ["ime", "fcitx", "chinese", "japanese", "korean", "pinyin"] },
  { pane: "trackpad", row: "tap-to-click", title: "Tap to click", words: ["tap", "touchpad tap"] },
  { pane: "trackpad", row: "natural-scrolling", title: "Natural scrolling", words: ["reverse scrolling", "touchpad scrolling"] },
  { pane: "mouse", row: "natural-scrolling", title: "Natural scrolling", words: ["reverse scrolling", "wheel direction"] },
  { pane: "date-time", row: "24-hour-time", title: "24-hour time", words: ["24-hour", "24 hour", "clock format"] },
  { pane: "date-time", row: "time-zone", title: "Time zone", words: ["timezone"] },
  { pane: "language-region", row: "first-day-of-week", title: "First day of the week", words: ["first day of week", "week starts"] },
];

/** A row search finds: choosing it opens Settings at the row, lit. */
export function spotAction(row: SpotRow, open: SettingsDeps["open"]): ActionDef {
  return {
    address: formatAddress(["settings", row.pane, row.row]),
    title: row.title,
    description: "",
    keywords: { en: [row.title.toLowerCase(), ...row.words] },
    kind: "open",
    properties: {},
    scope: null,
    readOnly: true,
    destructive: false,
    who: "person",
    source: "settings",
    place: { pane: row.pane, row: row.row },
    check: () =>
      ready(async () => {
        open(row.pane, row.row);
        return ok(`${row.title} is shown in Settings.`);
      }),
  };
}

/** Whether `name` is a setting `set_setting` takes. */
export const isSettingKey = (name: string): name is SettingKey => SETTING_ROWS.some((row) => row.setting === name);

/** What a setting is now, read from the same stores `get_settings` reads (agents/desktop/settings.ts). */
export function settingState(desktop: Pick<Desktop, "flags" | "dock" | "corners" | "scrollSpeed" | "menuBar">, setting: SettingKey): ActionState {
  const flags = desktop.flags.getSnapshot();
  switch (setting) {
    case "dark_mode":
      return flags.dark;
    case "do_not_disturb":
      return flags.dnd;
    case "night_shift":
      return flags.night;
    case "window_corners":
      return desktop.corners.get();
    case "dock_autohide":
      return desktop.dock?.snapshot.autohide ?? null;
    case "dock_style":
      return desktop.dock?.snapshot.style ?? null;
    case "trackpad_scroll_speed":
      return desktop.scrollSpeed.get("trackpad");
    case "mouse_scroll_speed":
      return desktop.scrollSpeed.get("mouse");
    case "battery_percentage":
      return desktop.menuBar.get().batteryPercent;
    case "sound_in_menu_bar":
      return desktop.menuBar.get().sound;
  }
}

export interface SettingsDeps {
  /** What a setting is now; null where it isn't (no Dock). */
  state(setting: SettingKey): ActionState;
  /** Open System Settings at `pane`, scrolled to `row` and lighting it up. */
  open(pane: string, row?: string): void;
}

/** One setting's row: run with `value`, or, for a toggle, with none to flip it. */
export function settingAction(row: SettingRow, deps: SettingsDeps): ActionDef {
  const toggle = row.kind === "toggle";
  return {
    address: formatAddress(["settings", row.pane, row.row]),
    title: row.title,
    description: "",
    keywords: { en: [row.title.toLowerCase(), ...row.words, row.setting.replaceAll("_", " ")] },
    kind: row.kind,
    properties: { value: row.value ?? { type: "boolean", description: "On or off; left out, it switches." } },
    ...(toggle ? {} : { required: ["value"] }),
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: !toggle,
    who: "person",
    source: "settings",
    place: { pane: row.pane, row: row.row },
    state: () => deps.state(row.setting),
    check(args) {
      if (toggle && args.value === undefined) {
        return ready(async (ctx) => {
          const now = deps.state(row.setting);
          if (typeof now !== "boolean") return failed(`${row.title} isn't here.`);
          return change(row, !now, ctx);
        });
      }
      const call = parseCall({ name: "set_setting", arguments: { name: row.setting, value: args.value } });
      if ("arguments" in call) return invalid(call.arguments);
      if ("unknown" in call) return invalid(`Unknown setting ${row.setting}.`);
      return ready((ctx) => change(row, args.value, ctx));
    },
  };
}

async function change(row: SettingRow, value: unknown, ctx: ActionContext): Promise<Outcome> {
  const call = parseCall({ name: "set_setting", arguments: { name: row.setting, value } });
  if ("arguments" in call || "unknown" in call) return failed(`${row.title} can't be set to ${String(value)}.`);
  if (!ctx.tool) return failed("Settings can't be changed in this session.");
  const result = await ctx.tool(call);
  const words = result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ");
  return result.isError ? failed(words) : ok(words);
}

/** Every pane, opening System Settings there. */
export function paneActions(open: SettingsDeps["open"]): ActionDef[] {
  return PANES.map(
    (pane): ActionDef => ({
      address: formatAddress(["settings", pane.id]),
      title: pane.title,
      description: "System Settings",
      keywords: { en: [...pane.id.split("-"), ...(PANE_KEYWORDS[pane.id] ?? []), "settings"] },
      kind: "open",
      properties: {},
      scope: null,
      readOnly: true,
      destructive: false,
      who: "person",
      source: "settings",
      place: { pane: pane.id },
      check: () =>
        ready(async () => {
          open(pane.id);
          return ok(`${pane.title} is open.`);
        }),
    }),
  );
}

/** The panes, then every setting's row, then the rows search finds by name. */
export function settingsActions(deps: SettingsDeps): ActionDef[] {
  return [...paneActions(deps.open), ...SETTING_ROWS.map((row) => settingAction(row, deps)), ...SPOT_ROWS.map((row) => spotAction(row, deps.open))];
}
