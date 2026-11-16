/**
 * Waiting for a window's tree to settle after an action, by the tree events
 * its app sends (Atspi.watchChanges), never by reading it again and again:
 * done once no event came for QUIET_MS, or at most SETTLE_MS. Without events
 * (a bus that counts none) it does not wait.
 */

import type { A11yNode } from "../../atspi/index.ts";
import type { TreeBus } from "../types.ts";

export const QUIET_MS = 150;
export const SETTLE_MS = 1500;
/** How long an action is given to start changing things before it is taken to have changed nothing. */
export const FIRST_MS = 300;
const TICK_MS = 40;

export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A mark to settle from: the app's event count now. */
export const mark = (bus: TreeBus, app: A11yNode): number => bus.changesOf?.(app).count ?? 0;

/**
 * Wait until the app's tree is quiet; true when it changed since `from`.
 * `limit` caps the wait (wait_for's idle uses its own).
 */
export async function settle(bus: TreeBus, app: A11yNode, from: number, limit = SETTLE_MS, sleep: Sleep = realSleep): Promise<boolean> {
  const count = bus.changesOf;
  if (!count) return false;
  const started = Date.now();
  let last = count.call(bus, app);
  for (let waited = 0; waited < limit; waited += TICK_MS) {
    await sleep(TICK_MS);
    const now = count.call(bus, app);
    const quietFor = Date.now() - Math.max(now.at, started);
    if (now.count === from && waited + TICK_MS >= FIRST_MS) return false;
    if (now.count !== from && now.count === last.count && quietFor >= QUIET_MS) return true;
    last = now;
  }
  return count.call(bus, app).count !== from;
}
