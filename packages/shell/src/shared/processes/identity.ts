/**
 * Which app a process is, from what /proc says about it alone: its command
 * line, its control group, and its name (CP-6: show the app's name, never
 * `bun` or `mirin-metal-host`). Pure: the catalog of installed apps comes in
 * (catalog.ts), the facts come in (Activity Monitor's reader, the battery
 * monitor), an identity or null goes out. A process with no identity of its
 * own belongs to its nearest ancestor that has one (owners.ts).
 *
 * In order:
 * 1. Dashi's own apps: `bun …/apps/<dir>/main.tsx` (shared/apps/first-party.ts).
 * 2. Dashi itself: the compositor, the session and the shell.
 * 3. Flatpaks: the `app-flatpak-<id>-<n>.scope` their processes run in.
 * 4. Other apps: the program a desktop entry runs, by its file name, or an
 *    entry's id or window class, matched against the program and the kernel's
 *    name for the process.
 */

/** An app as a row shows it. `key` is the desktop entry's id when there is one: the battery menu names apps by the same keys. */
export interface AppIdentity {
  key: string;
  name: string;
  /** Full-color SVG or PNG path. */
  icon: string;
}

/** What is read about a process once (it doesn't change while the process runs the same program). */
export interface ProcessFacts {
  /** The kernel's name for it (15 bytes at most). */
  comm: string;
  /** Its command line, split at the NULs. */
  argv: readonly string[];
  /** /proc/<pid>/cgroup, the cgroup v2 line ("0::/user.slice/…"), or "" when unreadable. */
  cgroup: string;
}

/** The installed apps, as what a process can be matched by (catalog.ts builds it). */
export interface AppCatalog {
  /** A program's file name, lowercase ("firefox", "code"). */
  byProgram: ReadonlyMap<string, AppIdentity>;
  /** A desktop entry's id or its window class, lowercase ("org.mozilla.firefox"). */
  byId: ReadonlyMap<string, AppIdentity>;
  /** A first-party app's folder under shell/apps ("calculator"). */
  firstParty: ReadonlyMap<string, AppIdentity>;
  /** Dashi itself: the compositor, the session, the shell (and System Settings, which runs in it). */
  dashi: AppIdentity;
  /** The icon for an app with no entry. */
  genericIcon: string;
}

/** Programs that start other programs: their name says nothing about the app (dock/layout.ts has the same list for windows). */
export const WRAPPERS: ReadonlySet<string> = new Set(["env", "sh", "bash", "dash", "zsh", "flatpak", "snap", "gtk-launch", "nohup", "setsid", "systemd-run"]);
/** Interpreters: the script they run names the app, not them. */
export const INTERPRETERS: ReadonlySet<string> = new Set(["bun", "node", "python", "python3", "perl", "ruby", "java", "gjs"]);
/** Script names too common to stand for one app. */
const GENERIC_SCRIPTS: ReadonlySet<string> = new Set(["main.tsx", "main.ts", "main.js", "main.py", "index.js", "index.ts", "__main__.py", "-m", "-c"]);

/** `/proc/<pid>/cmdline` as its arguments; [] when it is empty or unreadable (a kernel thread, a zombie). */
export function parseCmdline(text: string | null): string[] {
  if (!text) return [];
  const parts = text.split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

/** "/usr/lib64/firefox/firefox" → "firefox". */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The program a command line runs, lowercase: past `env` and its settings,
 * and for an interpreter the script it runs. Null for a command line that
 * hands off to another launcher (`flatpak run`, `sh -c`).
 */
export function programOf(argv: readonly string[]): string | null {
  let index = 0;
  for (let step = 0; step < 8 && index < argv.length; step++) {
    const arg = argv[index] ?? "";
    const name = fileName(arg).toLowerCase();
    if (name === "env") {
      index++;
      while (index < argv.length && (argv[index]?.includes("=") || argv[index]?.startsWith("-"))) index++;
      continue;
    }
    if (WRAPPERS.has(name)) return null;
    if (INTERPRETERS.has(name) || /^python3\.\d+$/.test(name)) {
      index++;
      while (index < argv.length && argv[index]?.startsWith("-")) index++;
      continue;
    }
    return name === "" || GENERIC_SCRIPTS.has(name) ? null : name;
  }
  return null;
}

/** The folder of a first-party app a command line runs (`…/apps/<dir>/main.tsx`), or null. */
export function firstPartyDir(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const match = arg.match(/\/apps\/([a-z0-9-]+)\/main\.tsx$/);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Dashi's own processes: the compositor, and the shell's supervisor and shell (`…/shell/src/session.ts`, `…/shell/src/main.tsx`). */
export function isDashi(facts: Pick<ProcessFacts, "comm" | "argv">): boolean {
  return facts.comm === "dashi-comp" || facts.argv.slice(0, 3).some((arg) => /\/shell\/src\/(session|main)\.tsx?$/.test(arg));
}

/** A Flatpak's app id from the scope its processes run in ("app-flatpak-org.mozilla.firefox-1234.scope"); systemd writes "-" inside a name as "\x2d". */
export function flatpakId(cgroup: string): string | null {
  const match = cgroup.replaceAll("\\x2d", "-").match(/\/app-flatpak-([A-Za-z0-9_.-]+?)-\d+\.scope(?:\/|$)/m);
  return match?.[1] ?? null;
}

/** "org.gnome.TextEditor" → "TextEditor": a name for an app no entry names. */
function nameFromId(id: string): string {
  const last = id.split(".").filter(Boolean).at(-1) ?? id;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** Which app this process is by itself, or null when it is a helper (its ancestors decide) or no app at all. */
export function identify(facts: ProcessFacts, catalog: AppCatalog): AppIdentity | null {
  const dir = firstPartyDir(facts.argv);
  if (dir) {
    const own = catalog.firstParty.get(dir);
    // A Bun program of Dashi's that isn't an app (the dialog, the portal) works for whoever started it.
    if (own) return own;
  }
  if (isDashi(facts)) return catalog.dashi;
  const flatpak = flatpakId(facts.cgroup);
  if (flatpak) return catalog.byId.get(flatpak.toLowerCase()) ?? { key: flatpak, name: nameFromId(flatpak), icon: catalog.genericIcon };
  if (dir) return null;
  const program = programOf(facts.argv);
  const byProgram = program ? (catalog.byProgram.get(program) ?? catalog.byId.get(program)) : undefined;
  if (byProgram) return byProgram;
  // The kernel's name, for a program that rewrites its command line (Chromium's helpers do).
  const comm = facts.comm.toLowerCase();
  if (comm === "" || WRAPPERS.has(comm) || INTERPRETERS.has(comm)) return null;
  return catalog.byProgram.get(comm) ?? catalog.byId.get(comm) ?? null;
}
