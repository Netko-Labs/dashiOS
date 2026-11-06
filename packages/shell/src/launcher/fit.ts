/**
 * The list as drawn fits the panel, whatever put rows in it. measures.ts
 * chooses how many app, setting and file rows a text size has room for, but
 * rows also come from outside (search providers, an applet's answer) and
 * from agents (Now, Ask); at a large text size those ran past the panel's
 * foot. This drops rows from the end until everything fits, never "All apps"
 * or the Ask row (how the person goes further), and never a scope's own
 * scrolled list (`window`), which keeps to its height already.
 */

import type { Section } from "./rows.ts";

/** Rows that stay when the list is cut: the way to more (All apps) and the way to ask. */
const KEPT_ROWS = new Set(["all-apps"]);
const KEPT_SECTIONS = new Set(["ask"]);

const kept = (section: Section, rowId: string): boolean => KEPT_SECTIONS.has(section.id) || KEPT_ROWS.has(rowId);

/** How tall the sections are drawn: a head where there's a title, then a row each (a scope's window, the slots held). */
export function listHeight(sections: readonly Section[], row: number, head: number): number {
  return sections.reduce(
    (sum, section) => sum + (section.title !== undefined ? head : 0) + (section.window ?? section.rows.length + (section.reserved ?? 0)) * row,
    0,
  );
}

/** `sections`, cut from the end until they fit `room`; a section left with no rows goes. */
export function fitToRoom(sections: readonly Section[], room: { height: number; row: number; head: number }): Section[] {
  const out = sections.map((section) => ({ ...section, rows: [...section.rows] }));
  while (listHeight(out, room.row, room.head) > room.height) {
    let cut = false;
    for (let index = out.length - 1; index >= 0 && !cut; index--) {
      const section = out[index] as Section;
      if (section.window !== undefined) continue;
      if ((section.reserved ?? 0) > 0) {
        section.reserved = (section.reserved ?? 0) - 1;
        cut = true;
        break;
      }
      for (let at = section.rows.length - 1; at >= 0; at--) {
        if (kept(section, (section.rows[at] as Section["rows"][number]).id)) continue;
        section.rows.splice(at, 1);
        cut = true;
        break;
      }
      if (cut && section.rows.length === 0 && (section.reserved ?? 0) === 0) out.splice(index, 1);
    }
    if (!cut) break;
  }
  return out;
}
