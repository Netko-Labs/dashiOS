/**
 * Which Spaces are full-screen Desktops: one entry per Space, in order, the
 * window whose own Desktop it is, or null for a Desktop people made. A
 * full-screen Desktop is right after the Desktop its window came from (after
 * any others from there), so the Desktop it goes back to is the nearest one
 * on its left, which is also the rule when that Desktop was removed
 * meanwhile. Full-screen Desktops are not counted (settings.json
 * `spaces.count`) and have no slot in `spaces.names`: the names are by
 * Desktop, skipping them. Pure, so the rules are tested.
 */

import type { CompositorWindow } from "../../compositor/index.ts";

/** Per Space: the window it is the full-screen Desktop of, or null. */
export type Slots = readonly (number | null)[];

/** How many Desktops there are, full-screen ones left out. */
export const desktopCount = (slots: Slots): number => slots.filter((slot) => slot === null).length;

/** Space `index`'s place among the Desktops (what its entry in `spaces.names` is); Spaces past the slots are Desktops. */
export const desktopOrdinal = (slots: Slots, index: number): number => index - slots.slice(0, index).filter((slot) => slot !== null).length;

/** The full-screen Desktop of `window`, or null. */
export function slotOf(slots: Slots, window: number): number | null {
  const index = slots.indexOf(window);
  return index >= 0 ? index : null;
}

/** The Desktop nearest to Space `index` that is not a full-screen one: on its left, else on its right; null when there is none. */
export function nearestDesktop(slots: Slots, index: number): number | null {
  for (let at = index - 1; at >= 0; at--) if (slots[at] === null) return at;
  for (let at = index + 1; at < slots.length; at++) if (slots[at] === null) return at;
  return null;
}

/** Where a full-screen window on Space `from` goes back to: that Desktop, or for one on a full-screen Desktop (a dialog), that one's. */
export function originOf(slots: Slots, from: number): number | null {
  if (from < 0 || from >= slots.length) return null;
  return slots[from] === null ? from : nearestDesktop(slots, from);
}

/** Where the full-screen Desktop of a window from Desktop `origin` goes: right after it, after the ones from there already. */
export function insertionPoint(slots: Slots, origin: number): number {
  let at = origin + 1;
  while (at < slots.length && slots[at] !== null) at++;
  return at;
}

/** The slots for `count` Spaces when the compositor has more or fewer than known (a hand edit of settings.json): new ones at the end are Desktops. */
export function fitSlots(slots: Slots, count: number): (number | null)[] {
  return Array.from({ length: count }, (_, index) => slots[index] ?? null);
}

/** Whether `window` is `owner`'s or one of its own: a sheet of it, or its dialog. */
export const belongsTo = (window: Pick<CompositorWindow, "id" | "sheetOf" | "parent">, owner: number): boolean =>
  window.id === owner || window.sheetOf === owner || window.parent === owner;

/**
 * The slots after a restart of the shell, from what the compositor says: a
 * Space whose only window (its sheets and dialogs aside) is full screen is
 * that window's Desktop. `expected`, when known, is how many there should be
 * (the Spaces less the count settings.json kept); with none expected, none.
 * At least one Desktop is always left a Desktop.
 */
export function recoverSlots(count: number, windows: readonly CompositorWindow[], expected?: number): (number | null)[] {
  const slots: (number | null)[] = Array.from({ length: count }, () => null);
  let left = expected ?? count;
  for (let space = 0; space < count && left > 0; space++) {
    const on = windows.filter((window) => (window.space ?? 0) === space);
    const own = on.filter((window) => window.sheetOf === undefined && (window.parent === undefined || !on.some((other) => other.id === window.parent)));
    const [only] = own;
    if (own.length !== 1 || !only || only.fullscreen !== true || only.state !== "normal") continue;
    slots[space] = only.id;
    left--;
  }
  return desktopCount(slots) > 0 ? slots : Array.from({ length: count }, () => null);
}
