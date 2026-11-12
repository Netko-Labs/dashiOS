/** What the agents' server hears for every connection at once: ⌃❖Esc, an answer revoked in Settings, and the screen locking. */

import type { Compositor } from "../../compositor/index.ts";
import type { Grants } from "../consent.ts";
import type { LockWatch } from "../lock.ts";
import type { SiteGrants } from "../sites.ts";
import type { Session } from "./session/session.ts";

export interface AgentsWatch {
  compositor: Pick<Compositor, "on">;
  grants: Pick<Grants, "onChange">;
  sites: Pick<SiteGrants, "remove">;
  lock: Pick<LockWatch, "onChange">;
  /** Work alone (alone/): it ends at ⌃❖Esc, and at the lock unless the person chose to keep it. */
  alone?: { screenLocked(): void; stop(): unknown } | undefined;
  sessions(): Session[];
  stopSessions(stopping: Session[]): void;
  publish(): void;
}

/** Start listening; the function that stops it. */
export function watchAgents({ compositor, grants, sites, lock, alone, sessions, stopSessions, publish }: AgentsWatch): () => void {
  const offShortcuts = compositor.on((event) => {
    if (event.event !== "shortcut" || event.name !== "stop-agents") return;
    // ⌃❖Esc stops everything agents may do by themselves too.
    alone?.stop();
    stopSessions(sessions());
  });
  // A revoked answer is gone from the connections that hold it too.
  const offGrants = grants.onChange((change) => {
    if (!change.removed && !change.revoked) return;
    // Its websites go with it, and with "Use websites".
    if (change.removed || change.revoked?.includes("web")) sites.remove(change.key);
    for (const session of sessions()) session.revoke(change.key, change.revoked);
    publish();
  });
  // Locking takes down any sheet that is up; calls fail while it lasts.
  const offLock = lock.onChange((locked) => {
    if (!locked) return;
    for (const session of sessions()) session.screenLocked();
    alone?.screenLocked();
  });
  return () => {
    offShortcuts();
    offGrants();
    offLock();
  };
}
