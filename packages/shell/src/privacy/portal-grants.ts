/**
 * What apps were allowed through the portal, as xdg-desktop-portal keeps it:
 * its permission store (org.freedesktop.impl.portal.PermissionStore), one
 * table per kind of permission, each entry naming apps and what each was
 * answered. The Access dialog's answers (camera, microphone, location,
 * running in the background) land here, and so do the screenshot, wallpaper
 * and notification answers and the screen shares an app may start again
 * without asking. This file reads such entries into one grant per app and
 * permission, for Settings › Privacy & Security; permission-store.ts talks
 * to the store.
 */

/** One thing one app was allowed. */
export interface PortalGrant {
  /** The permission store's table and entry. */
  table: string;
  id: string;
  /** The app's id ("org.mozilla.firefox"); empty for an app outside Flatpak. */
  app: string;
  /** What it may do, in a few words ("Use the camera"). */
  what: string;
  /** Screen sharing and remote control, listed under Screen sharing. */
  screen: boolean;
  /** When it was last used, in seconds, where the store says (location). */
  lastUsed: number | null;
}

interface TableSpec {
  table: string;
  /** The entries read, each with what it means; none: every entry of the table (screen shares are one entry per share). */
  entries: Readonly<Record<string, string>> | null;
  /** Its meaning when `entries` is null. */
  what?: string;
  screen?: true;
  /** Whether an app's answer is a yes. */
  allowed(permissions: readonly string[]): boolean;
}

const yes = (permissions: readonly string[]): boolean => permissions[0] === "yes";

/** The tables xdg-desktop-portal writes, and what an entry in each means. */
export const PORTAL_TABLES: readonly TableSpec[] = [
  { table: "devices", entries: { camera: "Use the camera", microphone: "Use the microphone", speakers: "Play sound" }, allowed: yes },
  // [accuracy, last used]: NONE is a no.
  { table: "location", entries: { location: "See your location" }, allowed: (permissions) => permissions[0] !== undefined && permissions[0] !== "NONE" },
  { table: "background", entries: { background: "Run in the background" }, allowed: yes },
  { table: "notifications", entries: { notification: "Show notifications" }, allowed: yes },
  { table: "screenshot", entries: { screenshot: "Take screenshots" }, allowed: yes },
  { table: "wallpaper", entries: { wallpaper: "Change the wallpaper" }, allowed: yes },
  { table: "screencast", entries: null, what: "Share the screen again without asking", screen: true, allowed: (permissions) => permissions[0] !== "no" },
  {
    table: "remote-desktop",
    entries: null,
    what: "Control the computer again without asking",
    screen: true,
    allowed: (permissions) => permissions[0] !== "no",
  },
];

/** At most this many entries are read from a table of shares. */
export const MAX_ENTRIES = 64;

/** The `a{sas}` an entry's lookup answers, checked: app id → its answer. */
export function parsePermissions(value: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!(value instanceof Map)) return out;
  for (const [app, answer] of value) {
    if (typeof app !== "string" || app.length > 255 || !Array.isArray(answer)) continue;
    const strings = answer.filter((part): part is string => typeof part === "string").slice(0, 8);
    out.set(app, strings);
  }
  return out;
}

/** The grants in one entry: the apps whose answer is a yes. */
export function grantsOf(spec: TableSpec, id: string, permissions: ReadonlyMap<string, readonly string[]>): PortalGrant[] {
  const what = spec.entries ? spec.entries[id] : spec.what;
  if (what === undefined) return [];
  const grants: PortalGrant[] = [];
  for (const [app, answer] of permissions) {
    if (!spec.allowed(answer)) continue;
    const used = spec.table === "location" ? Number(answer[1]) : Number.NaN;
    grants.push({ table: spec.table, id, app, what, screen: spec.screen === true, lastUsed: Number.isFinite(used) && used > 0 ? used : null });
  }
  return grants;
}

/** A grant's key: the same app, table and entry are one grant (seen.ts keeps its time by it). */
export const grantKey = (grant: Pick<PortalGrant, "table" | "id" | "app">): string => `${grant.table}\u0000${grant.id}\u0000${grant.app}`;

/** The grants by app, apps in name order, each app's grants in the order of the tables. */
export function byApp<T extends { app: string }>(grants: readonly T[], nameOf: (app: string) => string): Array<{ app: string; name: string; grants: T[] }> {
  const groups = new Map<string, T[]>();
  for (const grant of grants) groups.set(grant.app, [...(groups.get(grant.app) ?? []), grant]);
  return [...groups]
    .map(([app, list]) => ({ app, name: nameOf(app), grants: list }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
