/**
 * The menu bar's status side when it runs out of room (docs/design.html,
 * "The menu bar"): the app's menus never give way, the status side does,
 * and at least `MENU_GAP` stays free between them. What can go goes into
 * "…" in a set order: apps' and applets' icons, the most recently added
 * first, then Sound, then Wi-Fi, then Do Not Disturb's moon. The clock,
 * Control Center, the battery, the agent mark and a recording never go:
 * whoever is watching stays in sight. "…" shows only when something went.
 * Pure: widths in, the keys shown and hidden out.
 */

/** The least room between the app's menus and the status side. */
export const MENU_GAP = 24;
/** "…": a 22 px circle. */
export const MORE_WIDTH = 22;
/** Between the status side's items (the row's gap). */
export const STATUS_GAP = 4;
/** An item never drawn yet is taken to be this wide until it is measured. */
export const UNMEASURED = 30;

export interface FitItem {
  key: string;
  width: number;
  /** Its turn to go, lowest first; null never goes. */
  goes: number | null;
}

export interface Fit {
  /** In the bar's order. */
  shown: string[];
  /** In the bar's order: what "…" holds. */
  hidden: string[];
}

const span = (items: readonly FitItem[], gap: number): number =>
  items.reduce((sum, item) => sum + Math.max(0, item.width), 0) + gap * Math.max(0, items.length - 1);

/**
 * Which items fit in `available` (the status side's room), in their order.
 * When all of them don't, "…" takes `more` (and a gap) of the room and the
 * items go in their turn until the rest fit, or nothing else may go.
 */
export function fitStatus(items: readonly FitItem[], available: number, gap = STATUS_GAP, more = MORE_WIDTH): Fit {
  if (span(items, gap) <= available) return { shown: items.map((item) => item.key), hidden: [] };
  const turns = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.goes !== null)
    .sort((a, b) => (a.item.goes ?? 0) - (b.item.goes ?? 0) || a.index - b.index);
  const gone = new Set<string>();
  const room = available - more - gap;
  for (const { item } of turns) {
    gone.add(item.key);
    if (
      span(
        items.filter((each) => !gone.has(each.key)),
        gap,
      ) <= room
    )
      break;
  }
  return {
    shown: items.filter((item) => !gone.has(item.key)).map((item) => item.key),
    hidden: items.filter((item) => gone.has(item.key)).map((item) => item.key),
  };
}

/** The room the status side has: the bar's width less its padding, the menus, and the gap. */
export function statusRoom(barWidth: number, menusWidth: number, padding: number): number {
  return Math.max(0, barWidth - padding - menusWidth - MENU_GAP);
}

/** When Sound, Wi-Fi and the moon go: after every extra. */
export const GOES = { sound: 10_000, network: 10_001, dnd: 10_002 } as const;

/** An extra's turn: the store keeps the newest first, so the newest goes first. */
export const extraGoes = (index: number): number => index;
