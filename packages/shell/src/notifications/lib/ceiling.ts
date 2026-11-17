/** The area's ceiling for notifications (round five, #23): at most three app groups, then one line "9 more" naming the apps it holds. */

import type { NotificationGroup } from "./group.ts";

export const MAX_GROUPS = 3;

export interface FoldedGroups {
  shown: NotificationGroup[];
  /** Notifications behind "n more", and their apps' names (first three). */
  more: { count: number; apps: string[] } | null;
}

export function foldGroups(groups: readonly NotificationGroup[], all = false): FoldedGroups {
  if (all || groups.length <= MAX_GROUPS) return { shown: [...groups], more: null };
  const rest = groups.slice(MAX_GROUPS);
  return {
    shown: groups.slice(0, MAX_GROUPS),
    more: { count: rest.reduce((sum, group) => sum + group.entries.length, 0), apps: rest.map((group) => group.name).slice(0, 3) },
  };
}
