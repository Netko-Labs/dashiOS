/** How long banners stay, and the clock the store counts them with. */

import type { NotifyInput } from "../types.ts";

/** How long a banner stays when the app doesn't say. */
export const DEFAULT_TIMEOUT_MS = 5_000;
/** An app's own `expire_timeout` is held to this range. */
const TIMEOUT_RANGE_MS = [1_000, 30_000] as const;
/** After the pointer leaves a banner it gets this long before it goes. */
export const HOVER_GRACE_MS = 2_000;

/** Run `run` after `ms`; returns how to cancel. Tests pass their own clock. */
export type Scheduler = (run: () => void, ms: number) => () => void;

export const timeoutScheduler: Scheduler = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/** How long a notification stays up, or null when it stays until closed. */
export function displayTime(input: Pick<NotifyInput, "urgency" | "expireTimeout">): number | null {
  if (input.urgency === "critical" || input.expireTimeout === 0) return null;
  if (input.expireTimeout < 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(input.expireTimeout, TIMEOUT_RANGE_MS[0]), TIMEOUT_RANGE_MS[1]);
}
