/**
 * Installed apps for the launcher: the installed ones (shared/app-entries)
 * with what opens in the shell itself (System Settings, its panes), and
 * launching (the launcher ranks them: launcher/ranking/).
 */

import { homedir } from "node:os";
import { displayName, type LaunchWatch, launch, SCREENSHOT_APP_ID, SETTINGS_APP_ID, SETUP_APP_ID, shellApps, shellEntryList } from "./apps.ts";
import { type Entry, pinnedKeywords, readEntries } from "./shared/app-entries/index.ts";

/**
 * How the shell's own apps are found: System Settings by the words people use
 * for settings. That "settings" means System Settings above anything else
 * named so, and that the Setup Assistant answers to "setup", "welcome" and
 * "first run" only, are the ranking's intents (launcher/ranking/lib/intents.ts).
 */
const SHELL_APP_WORDS: Readonly<Record<string, Pick<Entry, "keywords" | "detail">>> = {
  [SETTINGS_APP_ID]: {
    keywords: ["settings", "preferences", "control panel", "system", "options", "configuration"],
    detail: "all your settings",
  },
  [SETUP_APP_ID]: { keywords: ["setup", "welcome", "first run"], detail: "run first-time setup again" },
  [SCREENSHOT_APP_ID]: {
    keywords: ["screenshot", "screen shot", "capture", "screen capture", "record screen", "screen recording", "print screen", "snip", "grab"],
    detail: "capture or record the screen",
  },
};

/** What opens in the shell itself: its own apps (System Settings), then what they registered (Settings panes). */
export function shellEntries(): Entry[] {
  // The shell's own apps answer to the words people look for them by.
  const own = shellApps().map((app): Entry => {
    const words = SHELL_APP_WORDS[app.id];
    return { ...app, ...words, shell: true, keywords: [...(words?.keywords ?? []), ...pinnedKeywords(app)] };
  });
  // Settings panes ("display" finds Displays).
  const registered = shellEntryList().map(
    ({ fallbackKeywords, ...entry }): Entry => ({
      ...entry,
      shell: true,
      ...(fallbackKeywords ? { fallbackKeywords: [...fallbackKeywords] } : {}),
    }),
  );
  return [...own, ...registered];
}

/**
 * Every launchable app: Dashi's pinned apps first, then the shell's own and the first-party ones,
 * then the installed ones; `withHidden` adds the `NoDisplay` ones, which only name windows
 * (app-catalog.ts), never a list.
 */
export function loadEntries(options: { withHidden?: boolean } = {}): Entry[] {
  return readEntries({ ...options, shell: shellEntries(), nameOf: displayName });
}

/** Start `entry`; `watch` hears whether it quit as it started (apps.ts). */
export function launchEntry(entry: Entry, watch?: LaunchWatch): number | null {
  return launch({ ...entry, cwd: entry.cwd ?? homedir() }, watch);
}
