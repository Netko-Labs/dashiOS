/**
 * This login session, as logind sees it: `loginctl lock-session` (and the
 * tools that call it) lock the screen, and the screen's state goes back as
 * the session's lock hint, so logind and anything else watching it know.
 *
 * Only a lock request is honoured. logind also sends `Unlock`, but unlocking
 * stays with the password on the lock screen; nothing else may open it.
 */

import type { Logind } from "../logind.ts";
import type { LockWatch } from "./lockwatch.ts";
import { sayOnce } from "./log.ts";

export interface SessionWatchDeps {
  logind: Pick<Logind, "findSession" | "onSessionLock" | "setLockedHint">;
  /** Raises the lock screen. */
  lock(): void;
  watch: LockWatch;
}

/** Starts following the session; resolves to the function that stops, or a no-op when logind has no session for us. */
export async function watchSession(deps: SessionWatchDeps): Promise<() => void> {
  const { logind, lock, watch } = deps;
  const session = await logind.findSession(process.pid, process.env.XDG_SESSION_ID);
  if (session === null) {
    sayOnce("no-session", "logind knows no session for this shell, so loginctl lock-session and the lock hint are off");
    return () => {};
  }
  const stopSignal = await logind.onSessionLock(session, lock);
  let published: boolean | null = null;
  // The first call also clears a hint a previous shell left set.
  const publish = (locked: boolean) => {
    if (locked === published) return;
    published = locked;
    logind.setLockedHint(session, locked).catch((error) => sayOnce("locked-hint", "cannot set the session's lock hint", error));
  };
  publish(watch.isLocked);
  const stopHint = watch.onChange(publish);
  return () => {
    stopHint();
    void stopSignal().catch(() => {});
  };
}
