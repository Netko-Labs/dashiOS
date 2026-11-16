/**
 * A call as the capsule's line says it while the assistant works: Dashi's
 * words, from the call and its arguments, never the model's ("Opening
 * youtube.com", "Reading the page"). The tools' own titles say the rest.
 */

import { oneLine, settingWords } from "../../ask/index.ts";
import { type Call, TOOLS } from "../../tools/index.ts";

const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return oneLine(url, 40);
  }
};

const FIXED: Readonly<Record<string, string>> = {
  read_page: "Reading the page",
  click_element: "Clicking on the page",
  fill_element: "Typing on the page",
  select_option: "Choosing on the page",
  press: "Pressing a key on the page",
  scroll_page: "Scrolling the page",
  list_tabs: "Looking at the tabs",
  switch_tab: "Switching tabs",
  wait_for: "Waiting",
  click: "Clicking",
  type_text: "Typing",
  press_keys: "Pressing keys",
  scroll: "Scrolling",
  drag: "Dragging",
  screenshot: "Looking at the screen",
  list_windows: "Looking at your windows",
  list_apps: "Looking at your apps",
  close_window: "Closing a window",
  focus_window: "Bringing a window forward",
  ask_person: "Asking you",
  hand_over: "Handing over to you",
  sign_in: "Signing in",
  fill_code: "Entering the code",
  pay: "Paying",
  search_files: "Looking for the file",
  list_folder: "Looking in the folder",
  get_settings: "Reading the settings",
  list_notes: "Looking at your notes",
  search_notes: "Searching your notes",
  read_note: "Reading the note",
  list_events: "Looking at your calendar",
};

/** What the capsule says while `call` runs. */
export function stepWords(call: Call): string {
  switch (call.name) {
    case "open_url":
      return `Opening ${host(call.url)}`;
    case "launch_app":
      return `Opening ${oneLine(call.app, 32)}`;
    case "set_setting":
      return settingWords(call.setting, call.value);
    default:
      return FIXED[call.name] ?? TOOLS.find((tool) => tool.name === call.name)?.title ?? "Working";
  }
}

/** The tools that wait on the person: their time is not the assistant's own (the two minutes an ask may take). */
export const WAITS_ON_PERSON: ReadonlySet<string> = new Set(["ask_person", "hand_over", "sign_in", "fill_code", "pay"]);
