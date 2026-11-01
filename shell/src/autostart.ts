/**
 * XDG autostart: at the start of a login session, run the programs that
 * `~/.config/autostart/*.desktop` and `$XDG_CONFIG_DIRS/autostart/*.desktop`
 * (default `/etc/xdg/autostart`) ask to have running: network and sound
 * applets, sync clients, input-method daemons.
 *
 * Precedence follows the specification: an entry in a nearer directory hides
 * the one of the same file name in a farther one, even if the nearer one is
 * `Hidden=true` (which is how a person turns a system entry off, and why a
 * symlink to /dev/null does too). Of what is left, an entry runs unless it
 *
 * - is `Hidden=true` or `X-GNOME-Autostart-enabled=false`,
 * - names desktops in `OnlyShowIn` that do not include Dashi, or lists Dashi
 *   in `NotShowIn` (this covers most other desktops' daemons),
 * - belongs to a GNOME session phase before the applications
 *   (`X-GNOME-Autostart-Phase` other than Application: those are the other
 *   desktop's own session infrastructure),
 * - has a `TryExec` that is not installed, wants a terminal, or has no
 *   command.
 *
 * `NoDisplay=true` does not matter here: autostart entries are almost always
 * hidden from menus. `X-GNOME-Autostart-Delay` (seconds, at most five
 * minutes) is honored.
 *
 * The shell is restarted if it crashes, but the login session goes on, so
 * autostart runs once per login session: a marker file in `$XDG_RUNTIME_DIR`
 * (wiped at logout, named for `$XDG_SESSION_ID` so a runtime directory shared
 * by two sessions of one user does not make the second one skip it) is
 * created atomically before anything starts, and a shell that finds it
 * already there starts nothing. With no runtime directory, or one the marker
 * cannot be written in, nothing starts: a second run of the session's
 * programs is worse than none, and the log says why. A development run
 * (`system/stand-in.ts`) only logs what would start, and leaves the marker
 * alone.
 */

import { accessSync, closeSync, constants, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { iconPath, launch as launchApp, type App } from "./apps.ts";
import { desktopFields, parseExec, splitList } from "./entries.ts";

/** The desktop name `OnlyShowIn` and `NotShowIn` are matched against. */
export const DESKTOP = "Dashi";
/** Once this exists in the runtime directory, this login session has had its autostart. */
export const MARKER = "dashi-autostart.done";

/** The marker's file name for a login session; a missing or odd session id gets the plain name. */
export function markerName(session: string | undefined): string {
  return session && /^[A-Za-z0-9_-]{1,32}$/.test(session) ? `dashi-autostart-${session}.done` : MARKER;
}

const MAX_FILE_BYTES = 64 * 1024;
const MAX_FILES_PER_DIR = 512;
const MAX_DELAY_S = 300;

export interface AutostartEntry {
  /** The file name, `nm-applet.desktop`. */
  id: string;
  name: string;
  exec: string[];
  /** `Path=`, when it is an absolute directory that exists. */
  cwd?: string;
  delayMs: number;
}

export interface Skipped {
  id: string;
  reason: string;
}

export interface AutostartPlan {
  start: AutostartEntry[];
  skipped: Skipped[];
}

/** What the plan asks of the machine; tests substitute their own. */
export interface Probe {
  /** Where a program on PATH is, or null. */
  which(program: string): string | null;
  /** Whether `path` is a file the person may run. */
  executable(path: string): boolean;
  isDirectory(path: string): boolean;
}

export const machine: Probe = {
  which: (program) => Bun.which(program),
  executable(path) {
    try {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  isDirectory(path) {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
};

/** Where autostart entries live, nearest first. Relative entries in the environment are not directories the specification allows. */
export function autostartDirs(env: Record<string, string | undefined> = process.env, home = homedir()): string[] {
  const config = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, ".config");
  const system = (env.XDG_CONFIG_DIRS || "/etc/xdg").split(":").filter((dir) => dir !== "" && isAbsolute(dir));
  return [...new Set([config, ...system].map((dir) => join(dir, "autostart")))];
}

const yes = (fields: Map<string, string>, key: string): boolean => fields.get(key)?.toLowerCase() === "true";

/** The entry a .desktop file describes, or why it does not run. */
export function judge(id: string, text: string, probe: Probe = machine): AutostartEntry | string {
  const fields = desktopFields(text);
  const exec = fields.get("Exec");
  if (fields.get("Type") !== "Application" || !exec) return "not an application with a command";
  if (yes(fields, "Hidden")) return "hidden";
  if (fields.get("X-GNOME-Autostart-enabled")?.toLowerCase() === "false") return "turned off (X-GNOME-Autostart-enabled)";
  if (fields.has("OnlyShowIn") && !splitList(fields.get("OnlyShowIn")).includes(DESKTOP)) return "only for other desktops";
  if (splitList(fields.get("NotShowIn")).includes(DESKTOP)) return "not for Dashi";
  const phase = fields.get("X-GNOME-Autostart-Phase");
  if (phase !== undefined && phase !== "Application") return `another desktop's ${phase} phase`;
  if (yes(fields, "Terminal")) return "needs a terminal";
  const tryExec = fields.get("TryExec");
  if (tryExec && !(tryExec.includes("/") ? probe.executable(tryExec) : probe.which(tryExec) !== null)) return "TryExec is not installed";
  const argv = parseExec(exec);
  if (argv.length === 0) return "no command";
  const path = fields.get("Path");
  const delay = Number(fields.get("X-GNOME-Autostart-Delay"));
  return {
    id,
    name: fields.get("Name") || id.replace(/\.desktop$/, ""),
    exec: argv,
    ...(path && isAbsolute(path) && probe.isDirectory(path) ? { cwd: path } : {}),
    delayMs: Number.isFinite(delay) && delay > 0 ? Math.min(Math.floor(delay), MAX_DELAY_S) * 1000 : 0,
  };
}

/** Reads every directory (nearest first) and decides each file name once. */
export function planAutostart(dirs: readonly string[], probe: Probe = machine): AutostartPlan {
  const plan: AutostartPlan = { start: [], skipped: [] };
  const seen = new Set<string>();
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir).filter((name) => name.endsWith(".desktop")).sort().slice(0, MAX_FILES_PER_DIR);
    } catch {
      continue;
    }
    for (const id of names) {
      // A name seen in a nearer directory hides this one whatever came of it.
      if (seen.has(id)) continue;
      seen.add(id);
      const verdict = judgeFile(join(dir, id), id, probe);
      if (typeof verdict === "string") plan.skipped.push({ id, reason: verdict });
      else plan.start.push(verdict);
    }
  }
  return plan;
}

function judgeFile(path: string, id: string, probe: Probe): AutostartEntry | string {
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return "too large to be a launcher";
    return judge(id, readFileSync(path, "utf8"), probe);
  } catch {
    return "unreadable";
  }
}

/** Claim this login session's autostart: true for the first caller, false once it has been claimed. */
export function claimSession(runtimeDir: string, session?: string): boolean {
  try {
    // O_EXCL: of two shells starting at once, only one creates it.
    closeSync(openSync(join(runtimeDir, markerName(session)), "wx", 0o600));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      console.error("dashi-shell: autostart: could not write its marker, so nothing starts:", error instanceof Error ? error.message : error);
    }
    return false;
  }
}

export interface AutostartOptions {
  /** A development run: log what would start, start nothing, leave the marker. */
  developmentRun: boolean;
  env?: Record<string, string | undefined>;
  probe?: Probe;
  launch?: (app: App) => number | null;
  /** Runs `run` after `ms`; returns the function that cancels it. */
  schedule?: (run: () => void, ms: number) => () => void;
}

export interface Autostart {
  plan: AutostartPlan;
  /** Whether this shell did the session's autostart (false for a development run and for a restarted shell). */
  ran: boolean;
  /** Cancels entries still waiting out their delay. */
  close(): void;
}

export function startAutostart(options: AutostartOptions): Autostart {
  const env = options.env ?? process.env;
  const probe = options.probe ?? machine;
  const plan = planAutostart(autostartDirs(env), probe);
  const names = (entries: readonly AutostartEntry[]) => entries.map((entry) => entry.id.replace(/\.desktop$/, "")).join(", ") || "nothing";
  if (options.developmentRun) {
    // One line each: a machine's /etc/xdg/autostart can list dozens.
    console.error(`dashi-shell: autostart is off (development run); it would start ${names(plan.start)}`);
    for (const { id, reason } of plan.skipped) console.error(`dashi-shell: autostart would skip ${id}: ${reason}`);
    return { plan, ran: false, close() {} };
  }
  const runtime = env.XDG_RUNTIME_DIR;
  if (!runtime) {
    console.error("dashi-shell: autostart is off: no XDG_RUNTIME_DIR to keep the once-per-session marker in");
    return { plan, ran: false, close() {} };
  }
  if (!claimSession(runtime, env.XDG_SESSION_ID)) {
    console.error("dashi-shell: autostart already ran in this login session (or its marker could not be written)");
    return { plan, ran: false, close() {} };
  }
  const launch = options.launch ?? launchApp;
  const schedule =
    options.schedule ??
    ((later: () => void, ms: number) => {
      const timer = setTimeout(later, ms);
      return () => clearTimeout(timer);
    });
  const cancels: Array<() => void> = [];
  const run = (entry: AutostartEntry): void => {
    const app: App = { id: entry.id, name: entry.name, icon: iconPath("generic"), exec: entry.exec, ...(entry.cwd ? { cwd: entry.cwd } : {}) };
    if (launch(app) === null) console.error(`dashi-shell: autostart: ${entry.id} did not start`);
  };
  for (const entry of plan.start) {
    if (entry.delayMs > 0) cancels.push(schedule(() => run(entry), entry.delayMs));
    else run(entry);
  }
  console.error(`dashi-shell: autostart: starting ${names(plan.start)}${plan.skipped.length ? ` (${plan.skipped.length} entries are not for Dashi or are turned off)` : ""}`);
  return {
    plan,
    ran: true,
    close() {
      for (const cancel of cancels.splice(0)) cancel();
    },
  };
}
