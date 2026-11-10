/**
 * Installed apps for the launcher: freedesktop `.desktop` entries (the XDG
 * application directories, read by shared/apps/desktop-entry.ts) plus Dashi's
 * own pinned apps, with icons resolved from the icon theme (shared/apps/icons.ts),
 * and launching (the launcher ranks them: launcher/ranking/).
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { displayName, type LaunchWatch, launch, SCREENSHOT_APP_ID, SETTINGS_APP_ID, SETUP_APP_ID, shellApps, shellEntryList } from "./apps.ts";
import {
  type App,
  cachedIcon,
  type DesktopAction,
  dataDirs,
  desktopFiles,
  firstPartyApps,
  firstPartyKeywords,
  iconRoots,
  inTerminal,
  parseDesktopEntry,
  resolvePinned,
} from "./shared/apps/index.ts";
import type { Localized } from "./shared/locale/messages.ts";

export { calculate } from "./launcher-math.ts";

export interface Entry extends App {
  /** Other words people search for ("browser" for Firefox). */
  keywords: string[];
  /** Words it answers to only when nothing else matches ("settings" for a Settings pane; launcher/ranking/). */
  fallbackKeywords?: string[];
  /** A one-color SVG drawn on a neutral tile instead of `icon` (a Settings pane's glyph). */
  glyph?: string;
  /** A few muted words after the name, on the same line ("Web Browser", "Dark Mode, accent, corners"). */
  detail?: string;
  /** The app id its windows use when it differs from the desktop id. */
  wmClass?: string;
  /** One of the shell's own apps (System Settings): it wins ties in search over an installed app of the same words. */
  shell?: true;
  /**
   * `NoDisplay=true`: not listed (the launcher, search), but still the app its
   * windows belong to. Apps often keep the entry that names their windows
   * hidden beside a visible one (T3 Code's `com.t3tools.T3Code` beside
   * `t3code-nightly`), as GNOME and KDE allow.
   */
  hidden?: true;
  /** Its Name[xx], GenericName[xx] and Keywords[xx] in the person's language, for the ranking (launcher/ranking/). */
  localized?: Localized;
  /** Its `[Desktop Action]` groups ("New Private Window"): commands of the app in the action registry (actions/). */
  actions?: DesktopAction[];
  /** `Terminal=true` (htop): it runs in a terminal window, so `exec` starts the pinned Terminal with it (`loadEntries`). */
  terminal?: true;
}

/** What else a pinned app is found by: its id and its command's name, lowercased. */
export function pinnedKeywords(app: Pick<App, "id" | "exec">): string[] {
  const command = app.exec?.[0]?.split("/").at(-1);
  return [...new Set([app.id, command].filter((word): word is string => Boolean(word)).map((word) => word.toLowerCase()))];
}

/**
 * How the shell's own apps are found: System Settings by the words people use
 * for settings. That "settings" means System Settings above anything else
 * named so, and that the Setup Assistant answers to "setup", "welcome" and
 * "first run" only, are the ranking's intents (launcher/ranking/intents.ts).
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

/** Every launchable app: Dashi's pinned apps first, then the shell's own and the first-party ones, then the installed ones. */
/**
 * Entries that share a name (Dashi's own Files and Nautilus, both "Files")
 * get a word in parentheses that tells them apart: "Dashi" for Dashi's own
 * apps, otherwise the last part of the app id ("Files (Nautilus)").
 */
export function withDistinctNames(entries: Entry[]): Entry[] {
  // Hidden entries are never listed beside the others, so they neither need a distinct name nor give one.
  const counts = new Map<string, number>();
  for (const entry of entries) if (!entry.hidden) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  return entries.map((entry) => {
    if (entry.hidden || (counts.get(entry.name) ?? 0) < 2) return entry;
    const tag = entry.id.startsWith("dev.dashi.") ? "Dashi" : displayName(entry.id.replace(/\.desktop$/, ""), entry.name);
    return tag === entry.name ? entry : { ...entry, name: `${entry.name} (${tag})` };
  });
}

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
 * An installed entry as the launcher starts it: one with `Terminal=true`
 * runs in the pinned Terminal (apps.ts `inTerminal`); null when there is no
 * terminal to run it in.
 */
export function launchable<T extends Pick<Entry, "exec" | "cwd" | "env" | "terminal">>(
  entry: T,
  terminal: (argv: readonly string[]) => Pick<App, "exec" | "cwd" | "env"> | null = inTerminal,
): T | null {
  if (!entry.terminal) return entry;
  const wrapped = terminal(entry.exec ?? []);
  return wrapped ? { ...entry, ...wrapped } : null;
}

/** The installed apps; `withHidden` adds the `NoDisplay` ones, which only name windows (app-catalog.ts), never a list. */
export function loadEntries(options: { withHidden?: boolean } = {}): Entry[] {
  // A pinned app stands in for its desktop entry (the pinned Terminal is
  // foot.desktop), so it answers to that entry's id and command too.
  const entries: Entry[] = resolvePinned().map((app) => ({ ...app, keywords: pinnedKeywords(app) }));
  entries.push(...shellEntries());
  // Dashi's own apps that run as their own process (shared/apps/first-party.ts); found by their words, not by "bun".
  for (const app of firstPartyApps()) if (!entries.some((entry) => entry.id === app.id)) entries.push({ ...app, keywords: firstPartyKeywords(app.id) });
  const seen = new Set(entries.map((entry) => entry.id));
  const roots = iconRoots();
  for (const dir of dataDirs()) {
    // The first folder with an id has it (the person's own over the system's), as the specification says.
    for (const { id, path } of desktopFiles(join(dir, "applications"))) {
      if (seen.has(id)) continue;
      seen.add(id);
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      const parsed = parseDesktopEntry(id, text);
      if (!parsed || (parsed.hidden && !options.withHidden)) continue;
      const { iconName, ...entry } = parsed;
      const runnable = launchable(entry);
      if (runnable) entries.push({ ...runnable, icon: cachedIcon(iconName, roots) });
    }
  }
  return withDistinctNames(entries);
}

/** Start `entry`; `watch` hears whether it quit as it started (apps.ts). */
export function launchEntry(entry: Entry, watch?: LaunchWatch): number | null {
  return launch({ ...entry, cwd: entry.cwd ?? homedir() }, watch);
}
