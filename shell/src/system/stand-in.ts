/**
 * Whether this shell is a development run, one whose writes to the machine
 * (its network and radios, its login session's bus names, its autostart)
 * must go nowhere. A shell nested in a window, or run by hand under another
 * desktop, belongs to a machine the developer is using: joining a network, a
 * scan, switching Wi-Fi or Bluetooth off, or claiming
 * `org.freedesktop.Notifications` on their bus would reach them. Wi-Fi and
 * Bluetooth each get an in-memory stand-in (`wifi/fake.ts`,
 * `bluetooth/fake.ts`) that touches nothing of the machine;
 * `control-center/radios.ts` keeps its switches off the machine too.
 *
 * A run is the session's own only when it is positively so: started by a
 * dashi-comp that drives the display itself (the same walk up to dashi-comp
 * that Log Out uses, `isRealSession` in `menus/session.ts`). Everything else
 * is a development run, including a doubt.
 *
 * The overrides, each narrow:
 *  - `DASHI_REAL_SESSION=1` says this is the machine's own session whatever
 *    the walk finds (the development VM sets it, since its network and buses
 *    are its own even in its nested Weston mode). It covers Wi-Fi, Bluetooth,
 *    the radios, polkit, autostart, and notifications.
 *  - `DASHI_FAKE_NM=1` or `0` forces the Wi-Fi and Bluetooth stand-ins (and
 *    the radios and sound that follow them) on or off, and nothing else.
 *  - `DASHI_NOTIFICATIONS=1` or `0` does the same for claiming the
 *    notification name (a nested run pointed at a private bus sets `1`).
 *  - Power has its own: `DASHI_POWER` (`power/nested.ts`).
 */

import { type Above, compositorAbove, isRealSession } from "../menus/session.ts";

export type Nesting = () => Above;
type Env = Record<string, string | undefined>;

/** Whether this is a development run, before any feature's own override. `nesting` is asked only if the environment does not decide. */
export function isDevelopmentRun(env: Env, nesting: Nesting = compositorAbove): boolean {
  if (env.DASHI_REAL_SESSION === "1") return false;
  return !isRealSession(nesting());
}

/** Whether Wi-Fi, Bluetooth, and the radios use their stand-ins. */
export function standsIn(env: Env, nesting: Nesting = compositorAbove): boolean {
  if (env.DASHI_FAKE_NM === "1") return true;
  if (env.DASHI_FAKE_NM === "0") return false;
  return isDevelopmentRun(env, nesting);
}

/** Whether the shell may claim `org.freedesktop.Notifications` on the session bus. */
export function mayServeNotifications(env: Env, nesting: Nesting = compositorAbove): boolean {
  if (env.DASHI_NOTIFICATIONS === "1") return true;
  if (env.DASHI_NOTIFICATIONS === "0") return false;
  return !isDevelopmentRun(env, nesting);
}
