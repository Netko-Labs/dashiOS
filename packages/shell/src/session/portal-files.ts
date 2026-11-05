/**
 * Dashi's portal backend for a checkout's session (session/dashi-portal).
 * Installed, xdg-desktop-portal finds dashi.portal in
 * /usr/share/xdg-desktop-portal/portals and D-Bus starts the backend from
 * /usr/share/dbus-1/services. A checkout has neither, so its session links
 * dashi.portal into the user's data folder and writes a D-Bus service file
 * there that runs the checkout's dashi-portal. That file names a checkout,
 * so an installed session removes it again (it would win over the system's).
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVICE = "org.freedesktop.impl.portal.desktop.dashi.service";
const PORTAL = "dashi.portal";
/** The first line of a service file this module wrote. */
const MARKER = "# Written by Dashi's session for a checkout (packages/shell/src/session/portal-files.ts).";

type Env = Readonly<Record<string, string | undefined>>;

const dataHome = (env: Env): string => env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share");

/** The service file that runs a checkout's dashi-portal (the bus starts it directly, no unit). */
export function checkoutService(sessionDir: string): string {
  return `${MARKER}\n[D-BUS Service]\nName=org.freedesktop.impl.portal.desktop.dashi\nExec=${join(sessionDir, "dashi-portal")}\n`;
}

/** Link the portal file and write the service file for a checkout's session dir. */
export function linkCheckoutPortal(sessionDir: string, env: Env, log: (message: string) => void): void {
  const data = dataHome(env);
  try {
    const portals = join(data, "xdg-desktop-portal", "portals");
    const link = join(portals, PORTAL);
    if (existsSync(join(sessionDir, PORTAL)) && !lstatSync(link, { throwIfNoEntry: false })) {
      mkdirSync(portals, { recursive: true });
      symlinkSync(join(sessionDir, PORTAL), link);
    }
    if (existsSync(join(sessionDir, "dashi-portal"))) {
      const services = join(data, "dbus-1", "services");
      const file = join(services, SERVICE);
      const current = existsSync(file) ? readFileSync(file, "utf8") : null;
      // A file the person wrote themselves is theirs.
      if (current === null || current.startsWith(MARKER)) {
        mkdirSync(services, { recursive: true });
        writeFileSync(file, checkoutService(sessionDir));
      }
    }
  } catch (error) {
    log(`could not set up the checkout's portal: ${String(error)}`);
  }
}

/** An installed session: forget a checkout's service file, so the system's starts the installed backend. */
export function forgetCheckoutPortal(env: Env): void {
  const file = join(dataHome(env), "dbus-1", "services", SERVICE);
  try {
    if (existsSync(file) && readFileSync(file, "utf8").startsWith(MARKER)) rmSync(file);
  } catch {
    // Nothing to forget.
  }
}
