/** Control Center's switches, the Appearance setting, and the Dock's settings, by the names agents use. */

import type { Flags } from "../../control-center/flags.ts";
import { json, type RunContext, text, type ToolResult, toolError } from "../context.ts";
import type { Call } from "../tools/index.ts";
import type { MenuBarSettingName, ScrollSettingName, SwitchName } from "../tools/types.ts";

const LABEL: Record<SwitchName | "dock_autohide", string> = {
  dark_mode: "Dark Mode",
  do_not_disturb: "Do Not Disturb",
  night_shift: "Night Shift",
  dock_autohide: "Dock autohide",
};
const KEY = { dark_mode: "dark", do_not_disturb: "dnd", night_shift: "night" } as const;

const read = (flags: Flags): Record<SwitchName, boolean> => ({ dark_mode: flags.dark, do_not_disturb: flags.dnd, night_shift: flags.night });

export function getSettings(ctx: RunContext): ToolResult {
  ctx.status("Checking your settings");
  const { dock } = ctx.desktop;
  const settings: Record<string, boolean | string | number> = {
    ...read(ctx.desktop.flags.getSnapshot()),
    window_corners: ctx.desktop.corners.get(),
    battery_percentage: ctx.desktop.menuBar.get().batteryPercent,
    sound_in_menu_bar: ctx.desktop.menuBar.get().sound,
    trackpad_scroll_speed: ctx.desktop.scrollSpeed.get("trackpad"),
    mouse_scroll_speed: ctx.desktop.scrollSpeed.get("mouse"),
  };
  if (dock) {
    settings.dock_autohide = dock.snapshot.autohide;
    settings.dock_style = dock.snapshot.style;
  }
  return json({ settings });
}

type SetSetting = Extract<Call, { name: "set_setting" }>;

export function setSetting(call: SetSetting, ctx: RunContext): ToolResult {
  if (call.setting === "dock_style") return setDockStyle(call, ctx);
  if (call.setting === "dock_autohide") return setDockAutohide(call, ctx);
  if (call.setting === "trackpad_scroll_speed" || call.setting === "mouse_scroll_speed") return setScrollSpeed(call, ctx);
  if (call.setting === "battery_percentage" || call.setting === "sound_in_menu_bar") return setMenuBar(call, ctx);
  if (call.setting === "window_corners") {
    const { value } = call;
    ctx.status(`Setting window corners to ${value}`);
    const changed = ctx.desktop.corners.get() !== value;
    // Saved to settings.json like the Appearance pane does; the shell follows the file.
    if (changed) ctx.desktop.corners.set(value);
    return text(`Window corners are ${value}${changed ? "" : " already"}.`, { name: call.setting, value, changed });
  }
  const { setting, value } = call;
  ctx.status(`Turning ${LABEL[setting]} ${value ? "on" : "off"}`);
  const changed = read(ctx.desktop.flags.getSnapshot())[setting] !== value;
  // The shell follows the store: the palette, the apps' settings, and the banners.
  ctx.desktop.flags.set({ [KEY[setting]]: value });
  return text(`${LABEL[setting]} is ${value ? "on" : "off"}${changed ? "" : " already"}.`, { name: setting, value, changed });
}

/** Saved to settings.json like Settings' Battery & Power and Sound panes do; the menu bar follows the file. */
function setMenuBar(call: Extract<SetSetting, { setting: MenuBarSettingName }>, ctx: RunContext): ToolResult {
  const key = call.setting === "battery_percentage" ? "batteryPercent" : "sound";
  const label = call.setting === "battery_percentage" ? "The battery percentage in the menu bar" : "Sound in the menu bar";
  ctx.status(`Turning ${label.toLowerCase()} ${call.value ? "on" : "off"}`);
  const changed = ctx.desktop.menuBar.get()[key] !== call.value;
  if (changed) ctx.desktop.menuBar.set({ [key]: call.value });
  return text(`${label} is ${call.value ? "on" : "off"}${changed ? "" : " already"}.`, { name: call.setting, value: call.value, changed });
}

const NO_DOCK = "The Dock's settings are not available here.";

/** The Dock's settings go through the store the Dock's menu and System Settings use (dock/prefs.ts). */
function setDockStyle(call: Extract<SetSetting, { setting: "dock_style" }>, ctx: RunContext): ToolResult {
  const { dock } = ctx.desktop;
  if (!dock) return toolError(NO_DOCK);
  ctx.status(`Changing the Dock to a ${call.value}`);
  const changed = dock.snapshot.style !== call.value;
  dock.set({ style: call.value });
  return text(`The Dock style is ${call.value}${changed ? "" : " already"}.`, { name: call.setting, value: call.value, changed });
}

function setDockAutohide(call: Extract<SetSetting, { setting: "dock_autohide" }>, ctx: RunContext): ToolResult {
  const { dock } = ctx.desktop;
  if (!dock) return toolError(NO_DOCK);
  ctx.status(`Turning ${LABEL.dock_autohide} ${call.value ? "on" : "off"}`);
  const changed = dock.snapshot.autohide !== call.value;
  dock.set({ autohide: call.value });
  return text(`${LABEL.dock_autohide} is ${call.value ? "on" : "off"}${changed ? "" : " already"}.`, { name: call.setting, value: call.value, changed });
}

/** Saved to settings.json like the Trackpad and Mouse panes do; the shell follows the file. */
function setScrollSpeed(call: Extract<SetSetting, { setting: ScrollSettingName }>, ctx: RunContext): ToolResult {
  const device = call.setting === "trackpad_scroll_speed" ? "trackpad" : "mouse";
  ctx.status(`Setting the ${device} scrolling speed to ${call.value}`);
  const changed = ctx.desktop.scrollSpeed.get(device) !== call.value;
  if (changed) ctx.desktop.scrollSpeed.set(device, call.value);
  return text(`The ${device} scrolling speed is ${call.value}${changed ? "" : " already"}.`, { name: call.setting, value: call.value, changed });
}
