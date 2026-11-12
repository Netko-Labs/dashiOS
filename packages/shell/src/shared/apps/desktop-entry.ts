/**
 * Reading freedesktop `.desktop` files: the `[Desktop Entry]` group (an
 * installed app: its name, command, icon name, words), the files under an
 * applications folder, and an entry's own actions (the specification's
 * `Actions=` key and its `[Desktop Action <id>]` groups: Firefox's "New
 * Private Window", Files' "New Window"), which the launcher shows as commands
 * of their app ("Firefox › New private window").
 *
 * An action without a name or a command is left out (the specification lets
 * D-Bus activated apps leave Exec out; Dashi doesn't activate them).
 * Localized names (`Name[de]`) are kept by language, as words it is found by.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type Localized, localizedDesktop } from "../locale/index.ts";

export interface DesktopAction {
  /** Its id in `Actions=`: letters, digits, and `-`. */
  id: string;
  name: string;
  /** `Name[lang]`, by language. */
  names: Readonly<Record<string, string>>;
  exec: string[];
  /** The group's `Icon`, as written (resolve it like the entry's). */
  iconName?: string;
}

const ID = /^[A-Za-z0-9-]{1,64}$/;
/** More than any app offers; a file with more is not trusted with them. */
const MAX_ACTIONS = 16;

/** The groups of a .desktop file: header to its keys, first of a repeated key wins. */
function groups(text: string): Map<string, Map<string, string>> {
  const found = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      const header = line.slice(1, -1);
      current = found.has(header) ? null : new Map();
      if (current) found.set(header, current);
      continue;
    }
    if (!current || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!current.has(key)) current.set(key, line.slice(eq + 1).trim());
  }
  return found;
}

const LOCALIZED = /^Name\[([A-Za-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?(?:@[A-Za-z]+)?)\]$/;

/** The actions `text` declares, in its order; `parseExec` turns an Exec line into argv (below). */
export function desktopActions(text: string, parseExec: (exec: string) => string[]): DesktopAction[] {
  const all = groups(text);
  const ids = (all.get("Desktop Entry")?.get("Actions") ?? "")
    .split(";")
    .map((id) => id.trim())
    .filter((id) => ID.test(id));
  const actions: DesktopAction[] = [];
  for (const id of [...new Set(ids)].slice(0, MAX_ACTIONS)) {
    const group = all.get(`Desktop Action ${id}`);
    const name = group?.get("Name");
    const exec = group?.get("Exec");
    if (!group || !name || !exec) continue;
    const argv = parseExec(exec);
    if (argv.length === 0) continue;
    const names: Record<string, string> = {};
    for (const [key, value] of group) {
      const lang = LOCALIZED.exec(key)?.[1];
      if (lang && value) names[lang.replace("_", "-")] = value;
    }
    const iconName = group.get("Icon");
    actions.push({ id, name, names, exec: argv, ...(iconName ? { iconName } : {}) });
  }
  return actions;
}

/** What a .desktop file says about its app, its icon still a name (`iconName`): the launcher's `Entry` (entries.ts) without the icon. */
export interface DesktopEntry {
  id: string;
  name: string;
  exec: string[];
  iconName: string;
  keywords: string[];
  detail?: string;
  wmClass?: string;
  hidden?: true;
  localized?: Localized;
  actions?: DesktopAction[];
  terminal?: true;
  gpu?: "discrete";
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
export function parseDesktopEntry(id: string, text: string): DesktopEntry | null {
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
