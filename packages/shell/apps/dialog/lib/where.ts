/**
 * Whether a dialog can be shown from where dashi-dialog was started: a script
 * run by cron, over ssh or by a systemd unit has none of the session's
 * environment, and says so in words its author can act on. Pure, so tested.
 */

import { join } from "node:path";

/** Why no dialog can be shown from here; null when one can. */
export function cannotShow(env: Record<string, string | undefined>, host: string, exists: (path: string) => boolean): string | null {
  // A Wayland client with no WAYLAND_DISPLAY looks for wayland-0, as libwayland does.
  const name = env.WAYLAND_DISPLAY || "wayland-0";
  const socket = name.startsWith("/") ? name : env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, name) : null;
  if (!(socket !== null && exists(socket)) && !env.DISPLAY) {
    return "dashi-dialog: there is no display to show a dialog on. Run it in the Dashi session, or give it the session's WAYLAND_DISPLAY and XDG_RUNTIME_DIR (a script started by cron, over ssh or by a systemd unit has neither).";
  }
  if (!exists(host)) return `dashi-dialog: no Metal host at ${host}; set DASHI_METAL_HOST`;
  return null;
}
