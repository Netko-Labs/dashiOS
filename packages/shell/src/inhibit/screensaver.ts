/**
 * org.freedesktop.ScreenSaver, for the apps that keep the screen awake
 * without the portal (Firefox, mpv, VLC, Chromium on some builds): Inhibit
 * gives a cookie, UnInhibit takes it back, and a caller that leaves the bus
 * lets go of everything it held (portal-host/service.ts watches the bus). Served
 * at /org/freedesktop/ScreenSaver and at /ScreenSaver, where older KDE-era
 * callers look. The screen saver itself is the lock screen; `Lock` locks.
 */

import { DBusError, ERRORS, type InterfaceSpec } from "../shared/dbus/index.ts";
import { InhibitFlag, type InhibitStore } from "./store.ts";

export const SCREENSAVER = "org.freedesktop.ScreenSaver";
export const SCREENSAVER_PATHS = ["/org/freedesktop/ScreenSaver", "/ScreenSaver"] as const;

export interface ScreenSaverHost {
  store: InhibitStore;
  /** Whether the session is locked now. */
  locked(): boolean;
  lock(): void;
  /** Seconds the person has been away; 0 while they are here. */
  idleSeconds(): number;
}

export function screenSaverInterface(host: ScreenSaverHost): InterfaceSpec {
  const caller = (sender: string | undefined): string => {
    if (!sender) throw new DBusError(ERRORS.accessDenied, "a caller with no bus name cannot hold the screen awake");
    return sender;
  };
  return {
    name: SCREENSAVER,
    methods: {
      Inhibit: {
        in: "ss",
        out: "u",
        handler: ([application, reason], call) => {
          const id = host.store.add({
            owner: caller(call.sender),
            appId: typeof application === "string" ? application : "",
            reason: typeof reason === "string" ? reason : "",
            flags: InhibitFlag.idle,
            via: "screensaver",
          });
          if (id === null) throw new DBusError(ERRORS.limitsExceeded, "too many holds from one caller");
          return id;
        },
      },
      UnInhibit: {
        in: "u",
        handler: ([cookie], call) => {
          host.store.release(Number(cookie), caller(call.sender));
        },
      },
      GetActive: { out: "b", handler: () => host.locked() },
      GetActiveTime: { out: "u", handler: () => (host.locked() ? Math.max(0, Math.round(host.idleSeconds())) : 0) },
      GetSessionIdleTime: { out: "u", handler: () => Math.max(0, Math.round(host.idleSeconds())) },
      SetActive: {
        in: "b",
        out: "b",
        handler: ([active]) => {
          if (active === true) host.lock();
          return active === true;
        },
      },
      Lock: { handler: () => host.lock() },
      SimulateUserActivity: { handler: () => {} },
    },
    signals: { ActiveChanged: "b" },
  };
}
