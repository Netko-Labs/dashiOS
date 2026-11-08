/**
 * Installed apps for the launcher: freedesktop `.desktop` entries (the XDG
 * application directories) plus Dashi's own pinned apps, with icons resolved
 * from the icon theme, and launching (the launcher ranks them: launcher/ranking/).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type DesktopAction, desktopActions } from "./actions/desktop-actions.ts";
import {
  type App,
  displayName,
  iconPath,
  inTerminal,
  type LaunchWatch,
  launch,
  resolvePinned,
  SCREENSHOT_APP_ID,
  SETTINGS_APP_ID,
  SETUP_APP_ID,
  shellApps,
  shellEntryList,
} from "./apps.ts";
import { firstPartyApps, firstPartyKeywords } from "./first-party.ts";
import { themeIcon } from "./icon-themes.ts";
import { type Localized, localizedDesktop } from "./launcher/ranking/locale.ts";

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

/**
 * The keys of a .desktop file's `[Desktop Entry]` group. Localized keys
 * (Name[es]) are skipped, the shell speaks the default, and the first of a
 * repeated key wins.
 */
export function desktopFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  let inEntry = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inEntry || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key.includes("[") || fields.has(key)) continue;
    fields.set(key, line.slice(eq + 1).trim());
  }
  return fields;
}

/**
 * Entries that are plumbing in Dashi: foot's client and server need a
 * `foot --server` running, which Dashi doesn't start, so from the launcher
 * they opened nothing. Its Terminal is foot itself.
 */
const PLUMBING = new Set(["footclient", "foot-server"]);

/** Parse the `[Desktop Entry]` group of a .desktop file, or null to skip it. */
export function parseDesktopEntry(id: string, text: string): (Omit<Entry, "icon"> & { iconName: string }) | null {
  if (PLUMBING.has(id)) return null;
  const fields = desktopFields(text);
  const yes = (key: string) => fields.get(key)?.toLowerCase() === "true";
  const name = fields.get("Name");
  const exec = fields.get("Exec");
  if (fields.get("Type") !== "Application" || !name || !exec) return null;
  // Hidden is the spec's "deleted"; NoDisplay only keeps it out of lists (`hidden` below).
  if (yes("Hidden")) return null;
  // Entries meant only for other desktops (KDE settings modules and such).
  if (fields.has("OnlyShowIn") && !splitList(fields.get("OnlyShowIn")).includes("Dashi")) return null;
  if (splitList(fields.get("NotShowIn")).includes("Dashi")) return null;
  const argv = parseExec(exec);
  if (!argv.length) return null;
  // What kind of app it is ("Web Browser"), after its name on the launcher's row; not when it only repeats the name.
  const generic = fields.get("GenericName");
  const localized = localizedDesktop(text);
  const actions = desktopActions(text, parseExec);
  return {
    ...(localized.name || localized.genericName || localized.keywords.length > 0 ? { localized } : {}),
    id,
    name,
    exec: argv,
    iconName: fields.get("Icon") ?? "",
    ...(fields.get("StartupWMClass") ? { wmClass: fields.get("StartupWMClass") as string } : {}),
    ...(yes("NoDisplay") ? { hidden: true as const } : {}),
    // A program for a terminal (htop, a TUI) is listed as GNOME lists it; it opens in the Terminal (`loadEntries`).
    ...(yes("Terminal") ? { terminal: true as const } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    // The freedesktop key, and KDE's older one (Steam sets both).
    ...(yes("PrefersNonDefaultGPU") || yes("X-KDE-RunOnDiscreteGpu") ? { gpu: "discrete" as const } : {}),
    ...(generic && generic.toLowerCase() !== name.toLowerCase() ? { detail: generic } : {}),
    keywords: [...splitList(fields.get("Keywords")), ...(generic ? [generic] : [])].map((word) => word.toLowerCase()),
  };
}

export function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * An Exec line as argv: quoted arguments kept whole, field codes (%f, %U, …)
 * dropped since the launcher passes no files, and %% unescaped.
 */
export function parseExec(exec: string): string[] {
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < exec.length; i++) {
    const c = exec[i] as string;
    if (quoted) {
      if (c === "\\" && i + 1 < exec.length) {
        current += exec[++i];
      } else if (c === '"') {
        quoted = false;
      } else {
        current += c;
      }
    } else if (c === '"') {
      quoted = true;
      started = true;
    } else if (c === " " || c === "\t") {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += c;
      started = true;
    }
  }
  if (started) args.push(current);
  return args
    .filter((arg) => !/^%[fFuUdDnNickvm]$/.test(arg))
    .map((arg) => arg.replace(/%[fFuUdDnNickvm]/g, "").replace(/%%/g, "%"))
    .filter((arg) => arg.length > 0);
}

const ICON_SIZES = ["scalable", "512x512", "256x256", "128x128", "96x96", "64x64", "48x48"];

/** An icon name (or absolute path) as a file the renderer can draw. */
export function resolveIcon(name: string, roots = iconRoots()): string {
  if (name.startsWith("/")) return existsSync(name) ? name : iconPath("generic");
  if (!name) return iconPath("generic");
  for (const root of roots) {
    for (const size of ICON_SIZES) {
      for (const ext of size === "scalable" ? ["svg"] : ["png", "svg"]) {
        const path = join(root, "hicolor", size, "apps", `${name}.${ext}`);
        if (existsSync(path)) return path;
      }
    }
  }
  for (const ext of ["svg", "png"]) {
    const path = `/usr/share/pixmaps/${name}.${ext}`;
    if (existsSync(path)) return path;
  }
  return themeIcon(name, roots) ?? iconPath("generic");
}

/**
 * Icons found so far, by name: an app's icon is looked for on disk once, not
 * at every load of the index. A name that found nothing is looked for again
 * next time (its app may be installing its icon right now).
 */
const appIcons = new Map<string, string>();

/** `resolveIcon`, remembered (`appIcons`). */
export function cachedIcon(name: string, roots: string[] = iconRoots(), resolve: (name: string, roots: string[]) => string = resolveIcon): string {
  const known = appIcons.get(name);
  if (known !== undefined) return known;
  const path = resolve(name, roots);
  if (path !== iconPath("generic")) appIcons.set(name, path);
  return path;
}

/**
 * The icon an app wears in the Dock and the launcher, for a list that names
 * apps by desktop entry (Open With): a pinned app's own (Helium is the
 * Browser), else its entry's `Icon` from the theme. `id` has no ".desktop".
 */
export function entryIcon(
  id: string,
  iconName: string,
  pinned: readonly Pick<App, "id" | "icon">[] = resolvePinned(),
  resolve: (name: string) => string = cachedIcon,
): string {
  return pinned.find((app) => app.id === id)?.icon ?? resolve(iconName);
}

/** File icons by the names asked for: a launcher keystroke never probes the theme twice for one kind of file. */
const fileIcons = new Map<string, string>();

/** The first of `names` the icon theme draws as a file or folder (`mimetypes`, `places`), else the generic icon. */
export function fileIcon(names: readonly string[], roots = iconRoots()): string {
  const key = names.join("\n");
  const known = fileIcons.get(key);
  if (known !== undefined) return known;
  let path = iconPath("generic");
  for (const name of names) {
    const themed = themeIcon(name, roots, ["mimetypes", "places"]);
    if (themed) {
      path = themed;
      break;
    }
  }
  fileIcons.set(key, path);
  return path;
}

/** XDG data directories, user first. An empty variable counts as unset (the specification says so). */
export function dataDirs(env: Record<string, string | undefined> = process.env, home: string = homedir()): string[] {
  const user = env.XDG_DATA_HOME || join(home, ".local/share");
  const system = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
  return [user, ...system];
}

function iconRoots(): string[] {
  return dataDirs().map((dir) => join(dir, "icons"));
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

/** The most `.desktop` files read from one applications folder, its subfolders included. */
const MAX_DESKTOP_FILES = 4096;

/**
 * The desktop files under an applications folder, with their desktop ids:
 * the path below the folder with `/` as `-`, as the specification says, so
 * Wine's `wine/Programs/Notepad++.desktop` is `wine-Programs-Notepad++`.
 * Subfolders count: Wine puts the programs it installs there.
 */
export function desktopFiles(dir: string, list: (dir: string) => string[] = listTree): Array<{ id: string; path: string }> {
  let files: string[];
  try {
    files = list(dir);
  } catch {
    return [];
  }
  return files
    .filter((file) => file.endsWith(".desktop"))
    .sort()
    .slice(0, MAX_DESKTOP_FILES)
    .map((file) => ({ id: file.slice(0, -".desktop".length).replaceAll("/", "-"), path: join(dir, file) }));
}

/** Every file below `dir`, as paths relative to it. */
function listTree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" });
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
  // Dashi's own apps that run as their own process (first-party.ts); found by their words, not by "bun".
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
