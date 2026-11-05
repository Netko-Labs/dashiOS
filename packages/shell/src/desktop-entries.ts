/**
 * Desktop entries for Dashi's first-party apps. At the start of a real
 * session the shell writes `dev.dashi.<app>.desktop` into the person's
 * `$XDG_DATA_HOME/applications` for each one (first-party.ts), so other
 * launchers and file managers can list them and `gio open` / `xdg-open` can
 * start them with a file (Preview). The Exec line runs this Bun on the app's
 * main.tsx from the shell's folder (`Path=`: Bun reads the tsconfig there).
 *
 * The shell owns only the files it wrote, which carry `X-Dashi-Managed=true`:
 * it rewrites them when their content changes and removes the `dev.dashi.*`
 * ones whose app is gone, and touches nothing else. It never writes the
 * person's `mimeapps.list`; which app is the default is theirs (and the
 * system's, `/etc/xdg/mimeapps.list`, from the installer).
 *
 * The strings follow the Desktop Entry specification: values escape `\`, and
 * an Exec argument with a reserved character is double-quoted with `"`, `` ` ``,
 * `$`, and `\` escaped, `%` doubled (the escapes of the two layers compose,
 * so one literal backslash is four in the file).
 */

import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { desktopFields } from "./entries.ts";
import { type FirstPartySpec, firstPartyApp } from "./first-party.ts";

/** The key that marks a file as the shell's; only files with it set to true are ever replaced or removed. */
export const MARKER_KEY = "X-Dashi-Managed";
const ID_PREFIX = "dev.dashi.";
const MAX_FILE_BYTES = 64 * 1024;
const MAX_FILES = 2048;

/** The characters that make an Exec argument need quotes. */
const EXEC_RESERVED = /[\s"'\\><~|&;$*?#()`]/;
const CONTROL = /[\0-\x1f\x7f]/;

/** `$XDG_DATA_HOME/applications`; an empty variable counts as unset. */
export function applicationsDir(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_DATA_HOME || join(home, ".local/share"), "applications");
}

/** One Exec argument as the specification quotes it (before the file-level escape of `\`), or null when it cannot be written. */
export function quoteExecArg(arg: string): string | null {
  if (CONTROL.test(arg)) return null;
  const percent = arg.replaceAll("%", "%%");
  if (percent !== "" && !EXEC_RESERVED.test(percent)) return percent;
  return `"${percent.replace(/["`$\\]/g, "\\$&")}"`;
}

/** A string value as the file holds it: `\` doubled. Null for what a line cannot carry. */
export function escapeValue(value: string): string | null {
  return CONTROL.test(value) ? null : value.replaceAll("\\", "\\\\");
}

/** The Exec value for `argv` plus an optional field code (`%f`); null when an argument cannot be written. */
export function execLine(argv: readonly string[], fieldCode?: string): string | null {
  const quoted = argv.map(quoteExecArg);
  if (quoted.includes(null)) return null;
  const words = quoted as string[];
  // The backslash of the quoting rule is itself escaped in the file.
  const line = words.map((word) => word.replaceAll("\\", "\\\\")).join(" ");
  return fieldCode ? `${line} ${fieldCode}` : line;
}

export interface EntryContext {
  bun: string;
  /** The shell's folder with a trailing slash (first-party.ts `shellDir`). */
  root: string;
  /** The Metal host binary, given to the app as `--host <path>` (a launcher's environment may not carry DASHI_METAL_HOST). */
  host?: string;
}

/** The text of `spec`'s desktop entry, or null when a path in it cannot be written into one. */
export function desktopEntryText(spec: FirstPartySpec, context: EntryContext): string | null {
  const app = firstPartyApp(spec, context.bun, context.root);
  const exec = execLine([...(app.exec ?? []), ...(context.host ? ["--host", context.host] : [])], spec.mimeTypes?.length ? "%f" : undefined);
  const path = escapeValue(app.cwd ?? context.root);
  const icon = escapeValue(app.icon);
  const name = escapeValue(spec.name);
  if (exec === null || path === null || icon === null || name === null) return null;
  const lines = [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.5",
    `Name=${name}`,
    `Exec=${exec}`,
    `Path=${path}`,
    `Icon=${icon}`,
    "Terminal=false",
    "NoDisplay=false",
    `StartupWMClass=${spec.id}`,
    ...(spec.categories?.length ? [`Categories=${spec.categories.join(";")};`] : []),
    ...(spec.mimeTypes?.length ? [`MimeType=${spec.mimeTypes.join(";")};`] : []),
    ...(spec.keywords.length ? [`Keywords=${spec.keywords.filter((word) => !word.includes(";") && !CONTROL.test(word)).join(";")};`] : []),
    `${MARKER_KEY}=true`,
    "",
  ];
  return lines.join("\n");
}

/** The file name for an app id. */
export const entryFile = (id: string): string => `${id}.desktop`;

/** Whether `text` is a file the shell wrote. */
export function isManaged(text: string): boolean {
  return desktopFields(text).get(MARKER_KEY)?.toLowerCase() === "true";
}

/** The text of a regular file (not a link), or null when it is not one or is too large. */
function readRegular(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export interface SyncResult {
  written: string[];
  removed: string[];
  /** Entries left alone because a file of the person's (no marker) has the name. */
  skipped: string[];
}

/** Write `text` to `path` through a temporary file in the same folder. */
function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o644 });
  try {
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Nothing to clean.
    }
    throw error;
  }
}

/**
 * Bring `dir` in line with `specs`: write the entry of each (only when its
 * text changed), skip a name a person's own file holds, and remove the
 * `dev.dashi.*.desktop` files with the marker whose app is not in `specs`.
 */
export function syncDesktopEntries(
  specs: readonly FirstPartySpec[],
  dir: string,
  context: EntryContext,
  /** Entries that are not apps' (the dashi:// handler, actions/entry.ts): `dev.dashi.*` files kept in line the same way. */
  extra: readonly { file: string; text: string }[] = [],
): SyncResult {
  const result: SyncResult = { written: [], removed: [], skipped: [] };
  mkdirSync(dir, { recursive: true });
  const wanted = new Set<string>();
  const entries = [
    ...specs.flatMap((spec) => {
      if (!spec.id.startsWith(ID_PREFIX) || !/^[A-Za-z0-9._-]+$/.test(spec.id)) return [];
      const text = desktopEntryText(spec, context);
      return text === null ? [] : [{ file: entryFile(spec.id), text }];
    }),
    ...extra.filter(({ file }) => file.startsWith(ID_PREFIX) && /^[A-Za-z0-9._-]+\.desktop$/.test(file)),
  ];
  for (const { file, text } of entries) {
    wanted.add(file);
    const path = join(dir, file);
    const existing = readRegular(path);
    if (existing === text) continue;
    if (existing !== null && !isManaged(existing)) {
      result.skipped.push(file);
      continue;
    }
    if (existing === null && exists(path)) {
      // A link or something odd under our name: not ours to replace.
      result.skipped.push(file);
      continue;
    }
    writeAtomic(path, text);
    result.written.push(file);
  }
  let names: string[] = [];
  try {
    names = readdirSync(dir)
      .filter((name) => name.startsWith(ID_PREFIX) && name.endsWith(".desktop"))
      .slice(0, MAX_FILES);
  } catch {
    // Unreadable: nothing stale to find.
  }
  for (const name of names) {
    if (wanted.has(name) || result.skipped.includes(name)) continue;
    const path = join(dir, name);
    const text = readRegular(path);
    if (text === null || !isManaged(text)) continue;
    try {
      unlinkSync(path);
      result.removed.push(name);
    } catch {
      // Already gone.
    }
  }
  return result;
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether the shell should write entries at all: in a real session, or when `DASHI_DESKTOP_ENTRIES=1` says so; `=0` turns it off anywhere. */
export function shouldWriteEntries(env: Record<string, string | undefined>, developmentRun: boolean): boolean {
  if (env.DASHI_DESKTOP_ENTRIES === "1") return true;
  if (env.DASHI_DESKTOP_ENTRIES === "0") return false;
  return !developmentRun;
}

/**
 * At startup: sync the entries of the first-party apps that are installed
 * (their main.tsx exists), then refresh the MIME cache (`update-desktop-
 * database`, when it is installed) if anything changed. Failures are logged
 * and never stop the shell.
 */
export async function installDesktopEntries(
  specs: readonly FirstPartySpec[],
  context: EntryContext,
  options: { dir?: string; refresh?: (dir: string) => Promise<void>; extra?: readonly { file: string; text: string }[] } = {},
): Promise<SyncResult | null> {
  const dir = options.dir ?? applicationsDir();
  try {
    const result = syncDesktopEntries(specs, dir, context, options.extra);
    if (result.written.length + result.removed.length > 0) await (options.refresh ?? refreshCache)(dir);
    return result;
  } catch (error) {
    console.error("dashi-shell: could not write desktop entries:", error);
    return null;
  }
}

/** `update-desktop-database <dir>` so `gio` and file managers see the MimeType lines; a missing tool is fine. */
async function refreshCache(dir: string): Promise<void> {
  const tool = Bun.which("update-desktop-database");
  if (!tool) return;
  try {
    const child = Bun.spawn([tool, dir], { stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: 10_000 });
    await child.exited;
  } catch {
    // Not worth stopping for.
  }
}
