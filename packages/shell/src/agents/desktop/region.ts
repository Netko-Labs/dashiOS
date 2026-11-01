/**
 * Date, time, and region for agents (the Date & Time and Language & Region
 * panes' settings), and showing the Setup Assistant. The status line names
 * what the agent is doing; the time zone is not secret, but nothing typed
 * ever goes through here, and the password sheet a system change may raise
 * belongs to the person.
 */

import { describeFailure } from "../../region/store.ts";
import { json, type RunContext, text, type ToolResult, toolError } from "../context.ts";
import type { Call } from "../tools/index.ts";

export function getRegionSettings(ctx: RunContext): ToolResult {
  ctx.status("Checking date and time settings");
  const reading = ctx.desktop.region.read();
  return json({
    settings: {
      time_zone: reading.timeZone,
      set_time_automatically: reading.setTimeAutomatically,
      clock_24_hour: reading.clock24Hour,
      clock_24_hour_follows_region: !reading.clock24HourChosen,
      show_date_in_menu_bar: reading.showDateInMenuBar,
      language: reading.language,
      region_formats: reading.regionFormats,
      first_weekday: reading.firstWeekday,
      installed_locales: reading.installedLocales,
    },
  });
}

export async function setTimeZone(call: Extract<Call, { name: "set_time_zone" }>, ctx: RunContext): Promise<ToolResult> {
  const { region } = ctx.desktop;
  const before = region.read().timeZone;
  if (before === call.timeZone) return text(`The time zone is ${call.timeZone} already.`, { name: "time_zone", value: call.timeZone, changed: false });
  ctx.status(`Changing the time zone to ${call.timeZone}`);
  const failure = await region.setTimeZone(call.timeZone);
  if (failure === "unknown") return toolError(`${call.timeZone} is not a time zone this computer knows; get_region_settings shows the current one, and names look like Europe/Berlin.`);
  if (failure !== null) return toolError(describeFailure(failure));
  return text(`The time zone is ${call.timeZone}.`, { name: "time_zone", value: call.timeZone, changed: true });
}

export function setClock24Hour(call: Extract<Call, { name: "set_clock_24_hour" }>, ctx: RunContext): ToolResult {
  ctx.status(`Turning 24-hour time ${call.value ? "on" : "off"}`);
  const { region } = ctx.desktop;
  const changed = region.read().clock24Hour !== call.value;
  // Saved to settings.json like the Date & Time pane does; the clocks follow the file.
  region.setClock24Hour(call.value);
  return text(`24-hour time is ${call.value ? "on" : "off"}${changed ? "" : " already"}.`, { name: "clock_24_hour", value: call.value, changed });
}

export function setRegionFormats(call: Extract<Call, { name: "set_region_formats" }>, ctx: RunContext): ToolResult {
  ctx.status(call.locale === null ? "Making the region formats follow the language" : "Changing the region formats");
  const { region } = ctx.desktop;
  const before = region.read().regionFormats;
  if (!region.setRegionFormats(call.locale)) return toolError(`${call.locale} is not an installed locale; get_region_settings lists installed_locales.`);
  const changed = before !== call.locale;
  return text(call.locale === null ? `The region formats follow the language${changed ? "" : " already"}.` : `The region formats are ${call.locale}${changed ? "" : " already"}.`, {
    name: "region_formats",
    value: call.locale,
    changed,
  });
}

export function openSetupAssistant(call: Extract<Call, { name: "open_setup_assistant" }>, ctx: RunContext): ToolResult {
  ctx.status("Opening the Setup Assistant");
  ctx.desktop.setup.open(call.page ?? undefined);
  return text("The Setup Assistant is open on the person's screen. They make the choices; click and type_text do not reach it.");
}
