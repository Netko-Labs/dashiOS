/** Date, time, and region for agents, and the Setup Assistant. All under the "settings" permission. */

import { isFormatsLocale } from "../../region/locale.ts";
import { isTimezoneName } from "../../region/timezones.ts";
import { PAGES } from "../../setup/flow.ts";
import { fail, type ToolDef } from "./define.ts";

export const regionTools: readonly ToolDef[] = [
  {
    name: "get_region_settings",
    title: "Read date, time, and region settings",
    description:
      "The time zone (an IANA name such as Europe/Berlin), whether the clock is set automatically from the network, 24-hour time, whether the menu bar shows the date, the system language, the region whose formats dates, times, and numbers follow, the first day of the week, and the locales that can be named for the formats.",
    scope: "settings",
    readOnly: true,
    destructive: false,
    properties: {},
    parse: () => ({ name: "get_region_settings" }),
  },
  {
    name: "set_time_zone",
    title: "Change the time zone",
    description:
      "Set the computer's time zone to an IANA name from get_region_settings or tzdata, such as Asia/Tokyo. This changes the whole computer, so the system may ask the person for their password on screen: they type it, never you, and the call waits for their answer. If they decline, it says so and nothing changed.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: { time_zone: { type: "string", description: "An IANA time zone name, like America/New_York." } },
    required: ["time_zone"],
    parse: (args) =>
      isTimezoneName(args.time_zone)
        ? { name: "set_time_zone", timeZone: args.time_zone }
        : fail("`time_zone` must be an IANA time zone name such as Europe/Berlin."),
  },
  {
    name: "set_clock_24_hour",
    title: "Switch between 12-hour and 24-hour time",
    description:
      "Turn 24-hour time on (18:05) or off (6:05 PM) for the menu bar, the lock screen, and the other clocks of the desktop. This is the person's own setting, not the computer's.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: { value: { type: "boolean", description: "true for 24-hour time, false for 12-hour." } },
    required: ["value"],
    parse: (args) => (typeof args.value === "boolean" ? { name: "set_clock_24_hour", value: args.value } : fail("`value` must be true or false.")),
  },
  {
    name: "set_region_formats",
    title: "Change the region formats",
    description:
      "Set the region whose formats dates, times, numbers, and money follow, by an installed locale name from get_region_settings (such as de_DE.UTF-8). This is the person's own setting and does not change the system language. Pass null to follow the language again.",
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: { locale: { type: ["string", "null"], description: "A locale name like fr_CA.UTF-8, or null to follow the language." } },
    required: ["locale"],
    parse: (args) => {
      if (args.locale === null) return { name: "set_region_formats", locale: null };
      return isFormatsLocale(args.locale)
        ? { name: "set_region_formats", locale: args.locale }
        : fail("`locale` must be a locale name such as de_DE.UTF-8, or null.");
    },
  },
  {
    name: "open_setup_assistant",
    title: "Open the Setup Assistant",
    description: `Show the Setup Assistant window to the person (language, keyboard, Wi-Fi, time zone, appearance, agents): they make the choices, you do not. Optionally start on one page: ${PAGES.join(", ")}. It cannot be driven with click or type_text.`,
    scope: "settings",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: { page: { type: "string", enum: [...PAGES], description: "The page to start on; the welcome page by default." } },
    parse: (args) => {
      if (args.page === undefined) return { name: "open_setup_assistant", page: null };
      const page = PAGES.find((candidate) => candidate === args.page);
      return page ? { name: "open_setup_assistant", page } : fail(`\`page\` must be one of: ${PAGES.join(", ")}.`);
    },
  },
];
