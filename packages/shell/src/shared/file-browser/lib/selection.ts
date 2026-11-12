/**
 * What a click does to the selection (PA-10): a plain click selects the one
 * item, ⇧-click selects the run from the anchor (the last item clicked
 * without ⇧) to it, and ❖-click (or Ctrl-click) adds it or takes it out;
 * ⇧❖-click adds the run to what was selected. The order is the order shown.
 * And what a move key does (`navigate`): the arrows in two directions in a
 * grid of icons, Home, End and the page keys, ⇧ extending from the anchor.
 */

import type { Modifiers } from "@mirinjs/metal";

export interface Picked {
  selection: string[];
  /** Where the next ⇧-click's run starts. */
  anchor: string;
}

/** The selection after a click on `path` among `shown` (paths, in the order drawn). */
export function pick(shown: readonly string[], selection: readonly string[], anchor: string | null, path: string, held: Modifiers): Picked {
  const toggle = held.super || held.control;
  const from = anchor !== null && shown.includes(anchor) ? anchor : null;
  const at = shown.indexOf(path);
  if (held.shift && from !== null && at >= 0) {
    const start = shown.indexOf(from);
    const run = shown.slice(Math.min(start, at), Math.max(start, at) + 1);
    const picked = toggle ? [...selection.filter((each) => !run.includes(each)), ...run] : run;
    return { selection: picked, anchor: from };
  }
  if (toggle) {
    const selected = selection.includes(path);
    return { selection: selected ? selection.filter((each) => each !== path) : [...selection, path], anchor: path };
  }
  return { selection: [path], anchor: path };
}

/** Whether a click is a plain one: only a plain second click opens what it is on. */
export function isPlain(held: Modifiers): boolean {
  return !held.shift && !held.super && !held.control && !held.alt;
}

/** A key that moves through what is shown: the arrows, Home and End, Page Up and Page Down. */
export type Step = "left" | "right" | "up" | "down" | "home" | "end" | "page-up" | "page-down";

/** How the items are laid out: `columns` across (1 in a list), `page` rows to a screen. */
export interface Layout {
  columns: number;
  page: number;
}

export interface Moved extends Picked {
  /** Where the keyboard is now (a run's moving end): the next move starts there. */
  focus: string;
}

/**
 * The selection after a move key, as the Finder moves: from where the
 * keyboard last was (else the last item selected), ← → one place and ↑ ↓
 * one row (a row of icons is `columns` places; a list has no ← →), Home and
 * End to the first and last, Page Up and Down a screen of rows. With nothing
 * selected the forward keys start at the first item and the backward ones at
 * the last. ↑ on the first row stays; ↓ on the row above a short last row
 * goes to its last item. With ⇧ the run from the anchor to there is
 * selected and the anchor stays. Null when nothing moves.
 */
export function navigate(
  shown: readonly string[],
  selection: readonly string[],
  anchor: string | null,
  focus: string | null,
  step: Step,
  layout: Layout,
  extend: boolean,
): Moved | null {
  if (shown.length === 0) return null;
  const columns = Math.max(1, layout.columns);
  if (columns === 1 && (step === "left" || step === "right")) return null;
  const from = focus !== null && shown.includes(focus) ? focus : (selection.findLast((path) => shown.includes(path)) ?? null);
  const at = from === null ? -1 : shown.indexOf(from);
  const last = shown.length - 1;
  const forward = step === "right" || step === "down" || step === "end" || step === "page-down";
  let next: number;
  if (step === "home") next = 0;
  else if (step === "end") next = last;
  else if (at < 0) next = forward ? 0 : last;
  else {
    const page = columns * Math.max(1, layout.page);
    const by: Record<Exclude<Step, "home" | "end">, number> = { left: -1, right: 1, up: -columns, down: columns, "page-up": -page, "page-down": page };
    next = at + by[step];
    if ((step === "up" || step === "down") && (next < 0 || next > last)) {
      next = step === "down" && Math.floor(at / columns) < Math.floor(last / columns) ? last : at;
    }
    next = Math.max(0, Math.min(last, next));
  }
  const target = shown[next] as string;
  const start = extend && anchor !== null && shown.includes(anchor) ? anchor : null;
  if (start === null) return { selection: [target], anchor: target, focus: target };
  const a = shown.indexOf(start);
  return { selection: shown.slice(Math.min(a, next), Math.max(a, next) + 1), anchor: start, focus: target };
}
