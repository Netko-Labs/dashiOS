/**
 * A shell inside a development window must not act on the developer's own
 * login session: it would lock their real desktop on `loginctl lock-session`,
 * hold their power key, and set their session's lock hint. The same rule as
 * Log Out (menus/session.ts): the compositor above us runs inside another
 * display server, there is none above us, or its environment cannot be read
 * (only a positive answer turns power on). `DASHI_POWER=1` or `0` overrides it, for trying power
 * against a private bus (DBUS_SYSTEM_BUS_ADDRESS).
 */

import { readFileSync } from "node:fs";
import { compositorAbove, isRealSession } from "../menus/session.ts";

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** Whether power handling should stay off, and why not (for the log) when it should. */
export function powerOffReason(
  env: Record<string, string | undefined> = process.env,
  read: (path: string) => string | null = readText,
  pid = process.pid,
): string | null {
  if (env.DASHI_POWER === "0") return "DASHI_POWER=0";
  if (env.DASHI_POWER === "1") return null;
  return isRealSession(compositorAbove(read, pid))
    ? null
    : "not a Dashi session of its own: nested, run by hand, or dashi-comp unreadable (set DASHI_POWER=1 to override)";
}

/**
 * Whether blanking the screens after idle time stays off, and why. Inside
 * another desktop that desktop keeps the idle clock and blanks the real
 * screen; a nested Dashi that blanked its own window went black in the
 * middle of a work session. Off wherever power is (`powerOffReason`);
 * `DASHI_IDLE=1` turns it on anyway, to try blanking nested, and `0` off.
 */
export function idleOffReason(env: Record<string, string | undefined> = process.env, powerOff: () => string | null = () => powerOffReason(env)): string | null {
  if (env.DASHI_IDLE === "1") return null;
  if (env.DASHI_IDLE === "0") return "DASHI_IDLE=0";
  return powerOff();
}
