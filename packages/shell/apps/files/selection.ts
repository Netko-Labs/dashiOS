/**
 * What a click does to the selection (PA-10): a plain click selects the one
 * item, ⇧-click selects the run from the anchor (the last item clicked
 * without ⇧) to it, and ❖-click (or Ctrl-click) adds it or takes it out;
 * ⇧❖-click adds the run to what was selected. The order is the order shown.
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
