/**
 * Installed applets: `~/.local/share/dashi/applets/<id>/`, each the
 * package's files (applet.json, main.js, build.json, assets/) and
 * `install.json`, what Dashi keeps about it:
 *
 *   {"version": "0.1.0", "sha256": "…", "authorKey": "RWQ…", "source": "catalog",
 *    "catalog": "https://…/index.json",
 *    "consent": ["hardware.power", "notifications"], "disabled": {"reason": "pulled", "detail": "…"}}
 *
 * `authorKey` is the key the installed version was signed with: an update
 * must be signed by the same one (catalog.ts). `catalog` is the index it came
 * from: updates and the kill switch come from that catalog alone. A record
 * from before there was more than one catalog has none, and means Dashi's. `consent` is what the person
 * allowed; an applet runs only when it covers every permission it asks for.
 * The store (and `dashi-applet install`) installs and removes; the shell's
 * launcher (shell's src/applets/launcher.ts) runs
 * what is installed, allowed, and not disabled. Each applet's own files live
 * apart, in `~/.local/share/dashi/applet-data/<id>/` (its home in the sandbox).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isRefusal, refuse } from "@dashi/shape";
import { isAppletId, type Manifest, readManifest } from "./manifest.ts";
import type { Unpacked } from "./package.ts";
import { permissionName } from "./permissions.ts";

export interface InstallRecord {
  version: string;
  sha256: string;
  /** The author key it was verified with; null for one installed from a local file (`dashi-applet install`). */
  authorKey: string | null;
  source: "catalog" | "local";
  /** The index.json address of the catalog it was installed from; absent means Dashi's own (or a local file). */
  catalog?: string;
  /** Permission names the person allowed. */
  consent: string[];
  disabled?: { reason: "pulled" | "off"; detail?: string };
}

export interface InstalledApplet {
  manifest: Manifest;
  record: InstallRecord;
  dir: string;
}

const dataHome = (env: Record<string, string | undefined>, home: string): string => env.XDG_DATA_HOME || join(home, ".local/share");

/** Where installed applets are. */
export const appletsRoot = (env: Record<string, string | undefined> = process.env, home: string = homedir()): string =>
  join(dataHome(env, home), "dashi/applets");

/** Where each applet's own files are (its home inside the sandbox). */
export const appletDataRoot = (env: Record<string, string | undefined> = process.env, home: string = homedir()): string =>
  join(dataHome(env, home), "dashi/applet-data");

/** A catalog's index.json address as a record keeps it: https, or file:// (a test catalog). */
export const isCatalogAddress = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 2048 && /^(https:\/\/|file:\/\/\/)[^\s"<>]+$/.test(value);

/** install.json's text → the record, or null when it isn't one. */
export function parseRecord(text: string): InstallRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const fields = value as Record<string, unknown>;
  const strings = (list: unknown): list is string[] => Array.isArray(list) && list.every((each) => typeof each === "string");
  if (typeof fields.version !== "string" || typeof fields.sha256 !== "string" || !strings(fields.consent)) return null;
  if (fields.authorKey !== null && typeof fields.authorKey !== "string") return null;
  if (fields.source !== "catalog" && fields.source !== "local") return null;
  if (fields.catalog !== undefined && !isCatalogAddress(fields.catalog)) return null;
  const disabled = fields.disabled as Record<string, unknown> | undefined;
  const reason = disabled?.reason;
  return {
    version: fields.version,
    sha256: fields.sha256,
    authorKey: fields.authorKey,
    source: fields.source,
    ...(typeof fields.catalog === "string" ? { catalog: fields.catalog } : {}),
    consent: fields.consent,
    ...(reason === "pulled" || reason === "off" ? { disabled: { reason, ...(typeof disabled?.detail === "string" ? { detail: disabled.detail } : {}) } } : {}),
  };
}

/**
 * An installed applet whose files no longer read (its manifest names a
 * permission or a field this Dashi doesn't know, or a file is damaged): it
 * never runs, and Software lists it as needing an update, with Remove….
 */
export interface UnreadableApplet {
  /** Its folder's name, which is its id. */
  id: string;
  dir: string;
  /** The name applet.json gives, when that much reads. */
  name: string | null;
  /** install.json, when it reads: the catalog and the key an update must match. */
  record: InstallRecord | null;
  /** Why, in the parser's words (for the log). */
  reason: string;
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** applet.json's `name`, read as little as can be: for a list's row only. */
function nameOf(json: string | null): string | null {
  try {
    const name: unknown = json === null ? null : (JSON.parse(json) as Record<string, unknown> | null)?.name;
    return typeof name === "string" && name.trim() !== "" && name.length <= 40 && !/\p{Cc}/u.test(name) ? name.trim() : null;
  } catch {
    return null;
  }
}

/** One folder under the applets root: an applet, one that no longer reads, or null when it isn't one at all. */
function readFolder(root: string, name: string): InstalledApplet | UnreadableApplet | null {
  const dir = join(root, name);
  const manifestText = readText(join(dir, "applet.json"));
  const recordText = readText(join(dir, "install.json"));
  // Not an applet's folder: no id for a name, or neither file.
  if (!isAppletId(name) || (manifestText === null && recordText === null)) return null;
  const record = recordText === null ? null : parseRecord(recordText);
  const manifest = manifestText === null ? refuse("there is no applet.json") : readManifest(manifestText);
  const unreadable = (reason: string): UnreadableApplet => ({ id: name, dir, name: nameOf(manifestText), record, reason });
  if (isRefusal(manifest)) return unreadable(manifest.error);
  if (manifest.id !== name) return unreadable(`applet.json says it is ${manifest.id}`);
  if (!record) return unreadable("install.json is missing or damaged");
  if (record.version !== manifest.version) return unreadable(`install.json says ${record.version}, applet.json ${manifest.version}`);
  return { manifest, record, dir };
}

/** Every folder under `root`: the applets, and the ones that no longer read (said so in the log). */
export function scanInstalled(root: string = appletsRoot()): { applets: InstalledApplet[]; unreadable: UnreadableApplet[] } {
  const applets: InstalledApplet[] = [];
  const unreadable: UnreadableApplet[] = [];
  let names: string[];
  try {
    names = existsSync(root) ? readdirSync(root).sort() : [];
  } catch {
    names = [];
  }
  for (const name of names) {
    if (name.startsWith(".") || name.endsWith(".partial") || name.endsWith(".old")) continue;
    const read = readFolder(root, name);
    if (read === null) console.error(`dashi-shell: ${join(root, name)} is not an installed applet`);
    else if ("manifest" in read) applets.push(read);
    else {
      console.error(`dashi-shell: ${read.dir} no longer reads, so it doesn't run: ${read.reason}`);
      unreadable.push(read);
    }
  }
  return { applets, unreadable };
}

/** Every applet installed under `root` that reads; the rest are left out (and said so). */
export function readInstalled(root: string = appletsRoot()): InstalledApplet[] {
  return scanInstalled(root).applets;
}

/** What the consent sheet asks for, by name: its permissions, and its commands in the launcher (one name for all of them). */
export const COMMANDS_CONSENT = "launcher.commands";

/** The names the person must allow before it runs: each permission's, and `launcher.commands` when it adds any. */
export function consentNames(manifest: Pick<Manifest, "permissions" | "commands">): string[] {
  return [...manifest.permissions.map(permissionName), ...(manifest.commands.length > 0 ? [COMMANDS_CONSENT] : [])];
}

/** Whether the person allowed everything it asks for. */
export const isAllowed = (applet: Pick<InstalledApplet, "manifest" | "record">): boolean =>
  consentNames(applet.manifest).every((name) => applet.record.consent.includes(name));

/** Whether the launcher should run it now. */
export const shouldRun = (applet: InstalledApplet): boolean => isAllowed(applet) && applet.record.disabled === undefined;

/**
 * Puts a verified package's files in place of what was there, all at once:
 * written beside it first, then swapped in. The record goes in with them.
 */
export function installFiles(root: string, unpacked: Unpacked, record: InstallRecord): string {
  const id = unpacked.manifest.id;
  const dir = join(root, id);
  const partial = `${dir}.partial`;
  const old = `${dir}.old`;
  rmSync(partial, { recursive: true, force: true });
  for (const [name, bytes] of unpacked.files) {
    const path = join(partial, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes, { mode: 0o644 });
  }
  writeFileSync(join(partial, "install.json"), `${JSON.stringify(record, null, 2)}\n`);
  rmSync(old, { recursive: true, force: true });
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(partial, dir);
  rmSync(old, { recursive: true, force: true });
  return dir;
}

export function writeRecord(dir: string, record: InstallRecord): void {
  const path = join(dir, "install.json");
  writeFileSync(`${path}.new`, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(`${path}.new`, path);
}

/** Takes it off; its own files (applet-data) stay unless `data`. */
export function removeInstalled(root: string, id: string, data?: string): void {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) throw new Error(`not an applet id: ${id}`);
  rmSync(join(root, id), { recursive: true, force: true });
  if (data) rmSync(join(data, id), { recursive: true, force: true });
}
