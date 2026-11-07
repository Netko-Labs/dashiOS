/**
 * Which app each process belongs to: its own identity (identity.ts), else
 * its nearest ancestor's. A browser's renderers count as the browser, an
 * app's Metal host as the app, and a build started in Terminal as Terminal.
 * A process with no app above it (a system daemon, a user service) belongs
 * to none. Shared by Activity Monitor and the battery monitor, so both name
 * an app the same way and by the same key.
 */

import type { AppIdentity } from "./identity.ts";

/** What the walk needs of a process. */
export interface Ancestry {
  pid: number;
  ppid: number;
}

/** Parents followed at most; a session's process tree is a handful deep. */
const MAX_DEPTH = 32;

/**
 * The app `pid` belongs to, for the processes of one look: `own` says a
 * process's identity by itself (null for a helper). Answers are kept, so
 * asking for every process walks each branch once.
 */
export function ownerOf<P extends Ancestry>(processes: ReadonlyMap<number, P>, own: (process: P) => AppIdentity | null): (pid: number) => AppIdentity | null {
  const known = new Map<number, AppIdentity | null>();
  return (pid) => {
    const path: number[] = [];
    let found: AppIdentity | null = null;
    let at = processes.get(pid);
    for (let depth = 0; at && depth < MAX_DEPTH; depth++) {
      const cached = known.get(at.pid);
      if (cached !== undefined) {
        found = cached;
        break;
      }
      path.push(at.pid);
      const identity = own(at);
      if (identity) {
        found = identity;
        break;
      }
      // init and the kernel's thread parent have no app above them.
      if (at.ppid <= 2 || at.ppid === at.pid) break;
      at = processes.get(at.ppid);
    }
    for (const each of path) known.set(each, found);
    return found;
  };
}
