/**
 * What a change to a setting is called, and its values in words, for the
 * change log (log.ts): from the settings registry where a row holds the
 * value (its name, its options' labels, its default), else from the list
 * below for the values a pane keeps itself (the power mode, 24-hour time).
 * A change to anything else (how many Spaces there are, the launcher's
 * aliases, the photos added) has no words and is not an entry. Edit › Undo
 * names a change in Title Case, as menus do ("Undo Text Size").
 */

import { toBcp47 } from "../../region/locale.ts";
import { layoutWords, variantWords } from "../layouts.ts";
import { describeValue, findRow, type RowDef, rowName, SETTINGS_ROWS } from "../registry/index.ts";
import type { Change, ChangeWords } from "./log.ts";

/** Whether two values a setting held are the same (JSON's values: lists compare by their items; not set is not set). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Edit › Undo's names, for the changes Settings has named in its menu since 0.5.0. */
const MENU: Readonly<Record<string, string>> = {
  "appearance.textSize": "Text Size",
  "appearance.reduceMotion": "Reduce Motion",
  "appearance.cornerRadius": "Corners",
  "appearance.pointerSize": "Pointer Size",
  "appearance.highlightActiveWindow": "Highlight Active Window",
  "appearance.auto": "Automatic Appearance",
  "appearance.x11Apps": "X11 Apps",
  "clock.hour24": "24-Hour Time",
  "clock.showDate": "Show Date",
  "menuBar.batteryPercent": "Battery Percentage",
  "menuBar.sound": "Sound in Menu Bar",
  "idle.blankAfterSeconds": "Turn Display Off",
  "idle.sleepAfterSeconds": "Sleep After",
  "touchpad.tap": "Tap to Click",
  "touchpad.naturalScroll": "Natural Scrolling",
  "touchpad.accelSpeed": "Pointer Speed",
  "touchpad.scrollSpeed": "Scroll Speed",
  "touchpad.disableWhileTyping": "Ignore While Typing",
  "touchpad.clickMethod": "Click Method",
  "mouse.naturalScroll": "Natural Scrolling",
  "mouse.accelSpeed": "Pointer Speed",
  "mouse.accelProfile": "Acceleration",
  "mouse.scrollSpeed": "Scroll Speed",
  "keyboard.repeatRate": "Key Repeat",
  "keyboard.repeatDelay": "Delay Until Repeat",
  "flags.dark": "Dark Mode",
  "flags.dnd": "Do Not Disturb",
  "flags.night": "Night Shift",
};

/** Settings a pane keeps itself, outside the registry's rows: their name, where they are, and their values in words. */
interface Named {
  name: string;
  row: string;
  /** What not set means. */
  unset?: string;
  say?: (value: unknown) => string;
}

const capital = (word: string): string => (word ? word[0]?.toUpperCase() + word.slice(1) : word);
const plain = (value: unknown): string => (typeof value === "boolean" ? (value ? "on" : "off") : capital(String(value).replace(/-/g, " ")));

/** A locale as people say it: `en_US.UTF-8` is "English (United States)"; one Intl doesn't know stays as it is. */
export function localeWords(value: unknown): string {
  const name = String(value);
  const tag = toBcp47(name);
  if (!tag) return name;
  try {
    return new Intl.DisplayNames(["en"], { type: "language", languageDisplay: "standard" }).of(tag) ?? name;
  } catch {
    return name;
  }
}

const OWN: Readonly<Record<string, Named>> = {
  "appearance.auto": { name: "Automatic appearance", row: "appearance/dark-mode", unset: "off" },
  "clock.hour24": { name: "24-hour time", row: "date-time/24-hour-time", unset: "the region's" },
  "region.formats": { name: "Formats", row: "language-region/formats", unset: "the language's", say: localeWords },
  // One name for the layout, as the row and the picker say it (layouts.ts).
  "keyboard.layout": { name: "Keyboard layout", row: "keyboard/layout", unset: "English (US)", say: (value) => layoutWords(value) },
  "power.mode": { name: "Power mode", row: "battery/power-mode", unset: "Automatic" },
  "power.chargeLimit": { name: "Charge limit", row: "battery/charge-limit", unset: "100%", say: (value) => `${String(value)}%` },
  "power.boost": { name: "Boost clock", row: "battery/boost", unset: "Automatic" },
  "power.epp": { name: "Processor energy preference", row: "battery/prefer", unset: "By mode" },
  "power.batteryMaxKhz": { name: "Top speed on battery", row: "battery/top-speed", unset: "Full", say: (value) => `${(Number(value) / 1e6).toFixed(1)} GHz` },
  "power.fullBy": { name: "Full by a time", row: "battery/full-by", unset: "off", say: (value) => String(value) },
  "graphics.mode": { name: "Graphics mode", row: "graphics/mode", unset: "Automatic" },
  "nightShift.from": { name: "Night Shift from", row: "displays/night-shift-from", unset: "sunset", say: (value) => String(value) },
  "nightShift.to": { name: "Night Shift to", row: "displays/night-shift-to", unset: "sunrise", say: (value) => String(value) },
  "agents.answerer": { name: "Answer requests with", row: "agents/answer-with", unset: "nothing chosen" },
  "agents.handOff": { name: "Hand off to", row: "agents/hand-off-to", unset: "the first installed" },
  "agents.skipGrants": { name: "Don't ask for these again", row: "agents/skip-grants", unset: "off" },
  "agents.localModel": { name: "Local model", row: "agents/model", unset: "the first installed", say: (value) => String(value) },
  "agents.gptModel": { name: "GPT model", row: "agents/model", unset: "the most capable", say: (value) => String(value) },
};

/** The registry's row for each key it binds; the first wins where two panes show one setting. */
const BY_KEY = new Map<string, RowDef>();
for (const row of SETTINGS_ROWS) {
  if (row.value && !BY_KEY.has(row.value.key)) BY_KEY.set(row.value.key, row);
}

/** A number as a row says it: a factor as "2×", else to two places at most. */
function sayNumber(row: RowDef, value: number): string {
  if (row.factor) return `${Number(value.toFixed(2))}×`;
  return String(Number(value.toFixed(2)));
}

/** A value of a registry row in words; not set is the row's default. */
function sayRow(row: RowDef, value: unknown): string {
  const shown = value ?? row.value?.fallback;
  if (typeof shown === "boolean" || typeof shown === "string") return describeValue(row, shown);
  if (typeof shown === "number") return row.options?.some((option) => option.value === shown) ? describeValue(row, shown) : sayNumber(row, shown);
  return "default";
}

/** How a change to `key` reads; null when it isn't one people make. */
function wordsFor(change: Change): ChangeWords | null {
  const row = BY_KEY.get(change.key);
  const menu = MENU[change.key];
  if (row) {
    const name = rowName(row);
    return { name, menu: menu ?? name, from: sayRow(row, change.from), to: sayRow(row, change.to), row: row.id };
  }
  if (change.key === "keyboard.variant") {
    // A variant, or none, by the layout's one name (layouts.ts).
    const said = variantWords(change.from, change.to);
    return { name: "Keyboard layout", menu: menu ?? "Keyboard layout", ...said, row: "keyboard/layout" };
  }
  const own = OWN[change.key];
  if (!own) return null;
  const say = (value: unknown): string => (value === undefined || value === null ? (own.unset ?? "default") : (own.say ?? plain)(value));
  return { name: own.name, menu: menu ?? own.name, from: say(change.from), to: say(change.to), ...(findRow(own.row) ? { row: own.row } : {}) };
}

/** Words for a change of one or more values: the first one people make names it; null when none is. */
export function describeChanges(changes: readonly Change[]): ChangeWords | null {
  for (const change of changes) {
    const words = wordsFor(change);
    if (words) return words;
  }
  return null;
}

/** "Dark Mode on", "Text size: Larger": an entry's line. */
export function changeLine(words: Pick<ChangeWords, "name" | "to">): string {
  return words.to === "on" || words.to === "off" ? `${words.name} ${words.to}` : `${words.name}: ${words.to}`;
}
