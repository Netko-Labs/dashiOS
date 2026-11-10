/** The sidebar's measures (docs/design.html, "Settings") and the two sums the window's layout needs from them. */

import type { Bounds } from "@mirinjs/metal";

/** The sidebar's measures (docs/design.html, "Settings"). */
export const SIDEBAR = {
  width: 232,
  /** The top band, lights and search: at least this tall, its row centred on the lights and the rest of it below. */
  bar: 46,
  /** The search pill: a toolbar field's height, so centred on the lights it keeps 5 under the window's top. */
  search: 28,
  paddingTop: 5,
  paddingX: 10,
  paddingBottom: 10,
  row: 30,
  rowGap: 1,
  knob: 26,
  /** A group's label: 10.5 SemiBold, 7 over and 2 under. */
  label: 22,
} as const;

/** How tall the list is with every row showing, for groups of `[5, 3, …]` rows, the first unlabelled. */
export function sidebarListHeight(groups: readonly number[]): number {
  const rows = groups.reduce((sum, count) => sum + count, 0);
  const labels = Math.max(groups.length - 1, 0);
  return rows * SIDEBAR.row + Math.max(rows - 1, 0) * SIDEBAR.rowGap + labels * (SIDEBAR.label + SIDEBAR.rowGap);
}

/**
 * The top band under the sidebar's padding: a row whose centre is the
 * lights' centre (the search sits on their line, as every app's toolbar
 * does), then the room that keeps the band the design's 46 in all. Without
 * lights the row is the whole band.
 */
export function topBand(controls: Bounds | null): { row: number; below: number } {
  const band = SIDEBAR.bar - SIDEBAR.paddingTop;
  if (!controls) return { row: band, below: 0 };
  const row = Math.max(Math.round(2 * (controls.y + controls.height / 2 - SIDEBAR.paddingTop)), SIDEBAR.search);
  return { row, below: Math.max(band - row, 0) };
}
