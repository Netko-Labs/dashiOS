/**
 * The session's systemd --user target (session/dashi-session.target). It
 * binds graphical-session.target, which xdg-desktop-portal and other session
 * services require: without it apps get no portal (no Dark Mode for
 * libadwaita, no file chooser, no screen sharing). Started once the display
 * is published, stopped when the session ends.
 *
 * Installed, the unit is in /usr/lib/systemd/user and the portal config in
 * /usr/share/xdg-desktop-portal. A checkout has neither, so the files in its
 * session/ are linked into the user's config: `systemctl --user link` for the
 * unit, a symlink in ~/.config/xdg-desktop-portal for the config; the portal
 * backend's files are portal-files.ts's. The portal backend is stopped as a
 * session starts and as it ends, so a session never meets an older one's.
 */

import { existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { forgetCheckoutPortal, linkCheckoutPortal, STALE_UNITS } from "./portal-files.ts";

export const TARGET = "dashi-session.target";
const PORTALS = "dashi-portals.conf";
/** Has the session bus read its service files again (dbus-broker and dbus-daemon both take it). */
const BUS_RELOAD = ["busctl", "--user", "call", "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "ReloadConfig"] as const;

export interface TargetDeps {
  env: Readonly<Record<string, string | undefined>>;
  which(program: string): string | null;
  run(command: readonly string[]): Promise<string | null>;
  log(message: string): void;
}

/** Link a checkout's unit and portal config where systemd and the portal look. */
async function linkCheckoutFiles(dir: string, deps: TargetDeps): Promise<void> {
  const unit = join(dir, TARGET);
  if (existsSync(unit)) {
    const failure = await deps.run(["systemctl", "--user", "link", unit]);
    if (failure !== null) deps.log(`could not link ${TARGET} (${failure})`);
  }
  const conf = join(dir, PORTALS);
  const config = deps.env.XDG_CONFIG_HOME || join(deps.env.HOME || homedir(), ".config");
  const portalDir = join(config, "xdg-desktop-portal");
  const link = join(portalDir, PORTALS);
  try {
    if (!existsSync(conf)) return;
    mkdirSync(portalDir, { recursive: true });
    // A file the person put there wins; only a missing one is linked.
    if (!lstatSync(link, { throwIfNoEntry: false })) symlinkSync(conf, link);
  } catch (error) {
    deps.log(`could not link the portal config: ${String(error)}`);
  }
}

/** Bring the session target up (after the environment import). */
export async function startSessionTarget(deps: TargetDeps): Promise<void> {
  if (!deps.which("systemctl")) return;
  const files = deps.env.DASHI_SESSION_FILES;
  if (files) await linkCheckoutFiles(files, deps);
  // Dashi's portal backend: a checkout's, or (installed) the system's (lib/portal-files.ts).
  const changes = files ? linkCheckoutPortal(files, deps.env, deps.log) : forgetCheckoutPortal(deps.env);
  if (changes.unit) await deps.run(["systemctl", "--user", "daemon-reload"]);
  if (changes.service) await deps.run(BUS_RELOAD);
  // A backend an earlier session started would serve this one its old code: the next request starts this one's.
  await stopPortal(deps);
  // The portal may have failed to start earlier in this login (its target
  // was down); clear that so it's activated again on demand.
  await deps.run(["systemctl", "--user", "reset-failed", "xdg-desktop-portal.service"]);
  const failure = await deps.run(["systemctl", "--user", "start", TARGET]);
  deps.log(failure === null ? `started ${TARGET}` : `could not start ${TARGET} (${failure}); apps may get no portal`);
}

/** Stop Dashi's portal backend, in whichever unit it runs: by pattern, so only units that are loaded (portal-files.ts). */
async function stopPortal(deps: Pick<TargetDeps, "run">): Promise<void> {
  for (const unit of STALE_UNITS) await deps.run(["systemctl", "--user", "stop", unit]);
}

/** Take it down at the end of the session (best effort, quickly); the portal backend goes with it. */
export async function stopSessionTarget(deps: Pick<TargetDeps, "which" | "run">): Promise<void> {
  if (!deps.which("systemctl")) return;
  await deps.run(["systemctl", "--user", "stop", TARGET]);
  await stopPortal(deps);
}

/**
 * `systemctl`'s arguments to stop the target and the portal backend without waiting for them
 * (docs/architecture.md, "Processes", the supervisor).
 */
export function stopNowCommand(): string[] {
  return ["systemctl", "--user", "stop", "--no-block", TARGET, ...STALE_UNITS];
}

/**
 * Ask systemd to take the target down and return at once: the first thing a session does when it
 * is told to end. Logging out ends the login's scope, and what is left of the session is killed
 * with it a moment later, before the shell has stopped and `stopSessionTarget` could run: the
 * target stayed up, so Voice (its models in memory) and the portal backend ran on at the login
 * screen, where the backend's window host found no compositor and panicked every second and a
 * half. The user manager is outside the scope, so once it has been asked it finishes the job.
 */
export function stopSessionTargetNow(deps: Pick<TargetDeps, "which"> & { spawn(command: readonly string[]): void }): void {
  if (!deps.which("systemctl")) return;
  deps.spawn(stopNowCommand());
}
