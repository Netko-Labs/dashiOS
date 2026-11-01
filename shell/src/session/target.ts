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
 * unit, a symlink in ~/.config/xdg-desktop-portal for the config.
 */

import { existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const TARGET = "dashi-session.target";
const PORTALS = "dashi-portals.conf";

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
  // The portal may have failed to start earlier in this login (its target
  // was down); clear that so it's activated again on demand.
  await deps.run(["systemctl", "--user", "reset-failed", "xdg-desktop-portal.service"]);
  const failure = await deps.run(["systemctl", "--user", "start", TARGET]);
  deps.log(failure === null ? `started ${TARGET}` : `could not start ${TARGET} (${failure}); apps may get no portal`);
}

/** Take it down at the end of the session (best effort, quickly). */
export async function stopSessionTarget(deps: Pick<TargetDeps, "which" | "run">): Promise<void> {
  if (!deps.which("systemctl")) return;
  await deps.run(["systemctl", "--user", "stop", TARGET]);
}
