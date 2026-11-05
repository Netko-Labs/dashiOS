/**
 * Installed apps for the launcher: freedesktop `.desktop` entries (the XDG
 * application directories) plus Dashi's own pinned apps, with icons resolved
 * from the icon theme, ranked search, and launching.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type App, displayName, iconPath, launch, resolvePinned, SETUP_APP_ID, shellApps, shellEntryList } from "./apps.ts";
import { firstPartyApps, firstPartyKeywords } from "./first-party.ts";
import { themeIcon } from "./icon-themes.ts";
import { type Localized, localizedDesktop } from "./launcher/ranking/locale.ts";

export { calculate } from "./launcher-math.ts";

export interface Entry extends App {
  /** Other words people search for ("browser" for Firefox). */
  keywords: string[];
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
  if (yes("Hidden") || yes("Terminal")) return null;
  // Entries meant only for other desktops (KDE settings modules and such).
  if (fields.has("OnlyShowIn") && !splitList(fields.get("OnlyShowIn")).includes("Dashi")) return null;
  if (splitList(fields.get("NotShowIn")).includes("Dashi")) return null;
  const argv = parseExec(exec);
  if (!argv.length) return null;
  const localized = localizedDesktop(text);
  return {
    ...(localized.name || localized.genericName || localized.keywords.length > 0 ? { localized } : {}),
    id,
    name,
    exec: argv,
    iconName: fields.get("Icon") ?? "",
    ...(fields.get("StartupWMClass") ? { wmClass: fields.get("StartupWMClass") as string } : {}),
    ...(yes("NoDisplay") ? { hidden: true as const } : {}),
    // The freedesktop key, and KDE's older one (Steam sets both).
    ...(yes("PrefersNonDefaultGPU") || yes("X-KDE-RunOnDiscreteGpu") ? { gpu: "discrete" as const } : {}),
    keywords: [...splitList(fields.get("Keywords")), ...(fields.get("GenericName") ? [fields.get("GenericName") as string] : [])].map((word) =>
      word.toLowerCase(),
    ),
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

/** The first of `names` the icon theme draws as a file or folder (`mimetypes`, `places`), else the generic icon. */
export function fileIcon(names: readonly string[], roots = iconRoots()): string {
  for (const name of names) {
    const path = themeIcon(name, roots, ["mimetypes", "places"]);
    if (path) return path;
  }
  return iconPath("generic");
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

/** What else the shell's own apps are found by ("preferences" finds System Settings). */
const SHELL_KEYWORDS = ["settings", "preferences", "system", "options", "configuration"];
/** And what only one of them answers to ("welcome" finds the Setup Assistant). */
const OWN_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  [SETUP_APP_ID]: ["setup", "assistant", "welcome", "first run", "language", "region", "time zone"],
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

/** The installed apps; `withHidden` adds the `NoDisplay` ones, which only name windows (app-catalog.ts), never a list. */
export function loadEntries(options: { withHidden?: boolean } = {}): Entry[] {
  // A pinned app stands in for its desktop entry (the pinned Terminal is
  // foot.desktop), so it answers to that entry's id and command too.
  const entries: Entry[] = resolvePinned().map((app) => ({ ...app, keywords: pinnedKeywords(app) }));
  // The shell's own apps (System Settings) answer to the words people look for them by.
  for (const app of shellApps()) entries.push({ ...app, shell: true, keywords: [...SHELL_KEYWORDS, ...(OWN_KEYWORDS[app.id] ?? []), ...pinnedKeywords(app)] });
  // What else opens in the shell: Settings panes ("display" finds Displays).
  for (const entry of shellEntryList()) entries.push({ ...entry, shell: true });
  // Dashi's own apps that run as their own process (first-party.ts); found by their words, not by "bun".
  for (const app of firstPartyApps()) if (!entries.some((entry) => entry.id === app.id)) entries.push({ ...app, keywords: firstPartyKeywords(app.id) });
  const seen = new Set(entries.map((entry) => entry.id));
  const roots = iconRoots();
  for (const dir of dataDirs()) {
    const apps = join(dir, "applications");
    let files: string[] = [];
    try {
      files = readdirSync(apps).filter((file) => file.endsWith(".desktop"));
    } catch {
      continue;
    }
    for (const file of files) {
      const id = file.slice(0, -".desktop".length);
      if (seen.has(id)) continue;
      seen.add(id);
      let text: string;
      try {
        text = readFileSync(join(apps, file), "utf8");
      } catch {
        continue;
      }
      const parsed = parseDesktopEntry(id, text);
      if (!parsed || (parsed.hidden && !options.withHidden)) continue;
      const { iconName, ...entry } = parsed;
      entries.push({ ...entry, icon: resolveIcon(iconName, roots) });
    }
  }
  return withDistinctNames(entries);
}

/**
 * Entries matching `query`: the exact name, then an exact keyword (an app
 * called Terminal before the ones whose generic name is "Terminal"), then
 * name prefix, word start, anywhere, then keyword prefix.
 */
export function search(entries: readonly Entry[], query: string, limit = 7): Entry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (entry: Entry): number => {
    const name = entry.name.toLowerCase();
    if (name === q) return 0;
    if (entry.keywords.includes(q)) return 1;
    if (name.startsWith(q)) return 2;
    if (name.split(/[\s\-_.]+/).some((word) => word.startsWith(q))) return 3;
    if (name.includes(q)) return 4;
    if (entry.keywords.some((word) => word.startsWith(q))) return 5;
    return -1;
  };
  return entries
    .map((entry) => ({ entry, score: score(entry) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score || Number(b.entry.shell === true) - Number(a.entry.shell === true) || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export function launchEntry(entry: Entry): number | null {
  return launch({ ...entry, cwd: entry.cwd ?? homedir() });
}
