/**
 * get_settings and set_setting: the rows of System Settings named for agents
 * (settings-app/registry/), read and changed through the same stores the
 * panes use: Control Center's switches, the Dock's settings, and
 * settings.json, which the shell follows.
 */

import { AGENT_ROWS, agentRow, changedWords, describeValue, type RegistryStores, rowName } from "../../settings-app/registry/index.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";
import type { Call } from "../tools/index.ts";
import type { Desktop } from "./types.ts";

/** The registry's stores, as an agent's desktop has them. */
export const desktopStores = (desktop: Pick<Desktop, "flags" | "dock" | "settings">): RegistryStores => ({
  flags: desktop.flags,
  settings: desktop.settings,
  ...(desktop.dock ? { dock: desktop.dock } : {}),
});

export function getSettings(ctx: RunContext): ToolResult {
  ctx.status("Checking your settings");
  const stores = desktopStores(ctx.desktop);
  const settings: Record<string, boolean | string | number> = {};
  for (const row of AGENT_ROWS) {
    const value = row.value?.get(stores) ?? null;
    if (row.agent && value !== null) settings[row.agent] = value;
  }
  return json({ settings });
}

type SetSetting = Extract<Call, { name: "set_setting" }>;

export function setSetting(call: SetSetting, ctx: RunContext): ToolResult {
  const row = agentRow(call.setting);
  if (!row?.value) return toolError(`There is no setting ${call.setting}.`);
  const stores = desktopStores(ctx.desktop);
  const now = row.value.get(stores);
  if (now === null) return toolError(`${rowName(row)} isn't available here.`);
  const { value } = call;
  ctx.status(typeof value === "boolean" ? `Turning ${rowName(row)} ${value ? "on" : "off"}` : `Setting ${rowName(row)} to ${describeValue(row, value)}`);
  const changed = now !== value;
  if (changed) row.value.set(stores, value);
  return text(changedWords(row, value, changed), { name: call.setting, value, changed });
}
