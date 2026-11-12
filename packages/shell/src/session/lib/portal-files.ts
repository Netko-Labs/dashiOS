/**
 * Dashi's portal backend for a checkout's session (session/dashi-portal).
 * Installed, xdg-desktop-portal finds dashi.portal in
 * /usr/share/xdg-desktop-portal/portals and D-Bus starts the backend from
 * /usr/share/dbus-1/services as the dashi-portal user unit, which ends with
 * the graphical session. A checkout has neither, so its session links
 * dashi.portal into the user's data folder, writes a user unit that runs the
 * checkout's dashi-portal (ended with the graphical session too), and a D-Bus
 * service file that starts that unit. Those files name a checkout, so an
 * installed session removes them again (they would win over the system's).
 *
 * Every session starts with no backend running (`STALE_UNITS`): one left by
 * an earlier session would serve this one its old code.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVICE = "org.freedesktop.impl.portal.desktop.dashi.service";
const PORTAL = "dashi.portal";
/** A checkout's unit: its own name, so the installed dashi-portal.service is never shadowed. */
export const CHECKOUT_UNIT = "dashi-portal-checkout.service";
/** The first line of a file this module wrote. It keeps the file's old path: checkouts already have it. */
const MARKER = "# Written by Dashi's session for a checkout (packages/shell/src/session/portal-files.ts).";

/**
 * The units a backend from an earlier session may still run in, as patterns: the installed one and a
 * checkout's (`dashi-portal*.service`), and the transient unit the bus made when a service file named no
 * unit (before this one did). Patterns, never plain names: `systemctl stop` of a name loads that unit
 * first, a pattern only matches units systemd has loaded. The installed unit and a checkout's both claim
 * the backend's bus name, and systemd holds a name for one loaded unit only, so stopping both by name
 * loaded both and it refused the second ("Two services allocated for the same bus name", every time a
 * checkout's session started on a machine with Dashi installed).
 */
export const STALE_UNITS: readonly string[] = ["dashi-portal*.service", "dbus-*-org.freedesktop.impl.portal.desktop.dashi@*.service"];

/** Whether stopping `unit` leaves a unit that is not loaded alone (a pattern; systemd.unit(7), systemctl(1)). */
export const stopsOnlyLoaded = (unit: string): boolean => /[*?[]/.test(unit);

type Env = Readonly<Record<string, string | undefined>>;

const dataHome = (env: Env): string => env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share");
const configHome = (env: Env): string => env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
const serviceFile = (env: Env): string => join(dataHome(env), "dbus-1", "services", SERVICE);
const unitFile = (env: Env): string => join(configHome(env), "systemd", "user", CHECKOUT_UNIT);

/** A path as one word of a unit's ExecStart (systemd.service(5): quoting, `%` and `$` doubled). */
export function execWord(path: string): string {
  const escaped = path.replaceAll("%", "%%").replaceAll("$", "$$$$");
  return /^[\w/.+@:,=-]+$/.test(escaped) ? escaped : `"${escaped.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** The service file that starts a checkout's backend as its user unit. */
export function checkoutService(sessionDir: string): string {
  return `${MARKER}\n[D-BUS Service]\nName=org.freedesktop.impl.portal.desktop.dashi\nExec=${join(sessionDir, "dashi-portal")}\nSystemdService=${CHECKOUT_UNIT}\n`;
}

/** The user unit that runs a checkout's dashi-portal, as session/dashi-portal.service runs the installed one. */
export function checkoutUnit(sessionDir: string): string {
  return [
    MARKER,
    "[Unit]",
    "Description=Dashi portal backend (a checkout's)",
    "PartOf=graphical-session.target",
    "After=graphical-session.target",
    "Requisite=graphical-session.target",
    "",
    "[Service]",
    "Type=dbus",
    "BusName=org.freedesktop.impl.portal.desktop.dashi",
    `ExecStart=${execWord(join(sessionDir, "dashi-portal"))}`,
    "Restart=on-failure",
    "Slice=session.slice",
    "",
  ].join("\n");
}

/** What changed on disk: the unit (systemd reloads), the service file (the bus reloads). */
export interface PortalChanges {
  unit: boolean;
  service: boolean;
}

/** Write `text` to `file` unless the person wrote that file; whether it changed. */
function writeOurs(file: string, text: string): boolean {
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;
  // A file the person wrote themselves is theirs.
  if (current === text || (current !== null && !current.startsWith(MARKER))) return false;
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  return true;
}

/** Remove `file` if this module wrote it; whether it did. */
function removeOurs(file: string): boolean {
  try {
    if (!existsSync(file) || !readFileSync(file, "utf8").startsWith(MARKER)) return false;
    rmSync(file);
    return true;
  } catch {
    return false;
  }
}

/** Link the portal file and write the unit and service file for a checkout's session dir. */
export function linkCheckoutPortal(sessionDir: string, env: Env, log: (message: string) => void): PortalChanges {
  const changes = { unit: false, service: false };
  try {
    const portals = join(dataHome(env), "xdg-desktop-portal", "portals");
    const link = join(portals, PORTAL);
    if (existsSync(join(sessionDir, PORTAL)) && !lstatSync(link, { throwIfNoEntry: false })) {
      mkdirSync(portals, { recursive: true });
      symlinkSync(join(sessionDir, PORTAL), link);
    }
    if (existsSync(join(sessionDir, "dashi-portal"))) {
      changes.unit = writeOurs(unitFile(env), checkoutUnit(sessionDir));
      changes.service = writeOurs(serviceFile(env), checkoutService(sessionDir));
    }
  } catch (error) {
    log(`could not set up the checkout's portal: ${String(error)}`);
  }
  return changes;
}

/** An installed session: forget a checkout's unit and service file, so the system's starts the installed backend. */
export function forgetCheckoutPortal(env: Env): PortalChanges {
  return { unit: removeOurs(unitFile(env)), service: removeOurs(serviceFile(env)) };
}
