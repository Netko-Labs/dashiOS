/**
 * A live notification: the one on screen (or waiting for a banner), its
 * countdown, and the two things that stop it counting (the pointer on it, the
 * person having seen it in the center). The store (store.ts) changes these.
 */

import type { Notification } from "./types.ts";

export interface Live {
  notification: Notification;
  cancel: (() => void) | null;
  /** The pointer is on its banner: no countdown. */
  held: boolean;
  /** The person has it in front of them in the center: it never shows as a banner. */
  seen: boolean;
}

/**
 * The first id from `from` that no live notification has: u32, never 0, so
 * it skips any a replacing app has claimed.
 */
export function freeId(from: number, live: ReadonlyMap<number, unknown>): number {
  let id = from;
  while (live.has(id) || id === 0 || id > 0xffffffff) id = id >= 0xffffffff ? 1 : id + 1;
  return id;
}
