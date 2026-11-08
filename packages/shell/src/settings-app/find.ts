/**
 * Search in System Settings' header strip: what is typed finds panes and the
 * rows in them, from the settings registry (registry/) and the panes' words
 * (search.ts), so a row added to a pane is found here as it is in the
 * launcher. The sidebar lists what was found in place of the panes; choosing
 * one opens its pane, scrolled to the row and lit (spot.tsx).
 *
 * Every word typed must start a word of the title, the name, the pane, or a
 * keyword: "night" finds Night Shift, "charge" the charge limit. A title
 * that starts with what was typed comes first, then one that holds it, then
 * a pane, then a row found by its other words.
 */

import { PANES, type PaneId, type PaneInfo } from "./panes.ts";
import { type RowDef, rowName, rowPlace, SETTINGS_ROWS } from "./registry/index.ts";
import { PANE_KEYWORDS } from "./search.ts";

export interface Found {
  /** `pane` for a pane, `pane/row` for a row: unique, a test id. */
  id: string;
  pane: PaneId;
  /** The row's part after the pane; absent for a pane. */
  row?: string;
  /** What the sidebar says: the row's name ("Charge limit"), or the pane's title. */
  label: string;
  /** The pane it is in, by its glyph. */
  glyph: string;
}

/** How many results the sidebar lists. */
export const FOUND_MOST = 40;

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}%]+/u)
    .filter(Boolean);

/** Whether every typed word starts some word of `haystack`. */
function matches(typed: readonly string[], haystack: readonly string[]): boolean {
  return typed.every((word) => haystack.some((each) => each.startsWith(word)));
}

/** Lower is better: the title starts with the text, holds it, then the rest. */
function rank(label: string, text: string, isPane: boolean): number {
  const lower = label.toLowerCase();
  if (lower.startsWith(text)) return 0;
  if (lower.includes(text)) return 1;
  return isPane ? 2 : 3;
}

const paneWords = (pane: PaneInfo): string[] => [...words(pane.title), ...pane.id.split("-"), ...(PANE_KEYWORDS[pane.id] ?? []).flatMap(words)];

const rowWords = (row: RowDef, pane: PaneInfo): string[] => [
  ...words(row.title),
  ...words(rowName(row)),
  ...(row.keywords ?? []).flatMap(words),
  ...words(pane.title),
];

/**
 * What `query` finds, best first, at most `FOUND_MOST`; nothing for an
 * empty query. `shown` leaves out the panes this machine doesn't list (no
 * graphics card, no Graphics).
 */
export function findSettings(query: string, shown: (pane: PaneInfo) => boolean = () => true): Found[] {
  const text = query.trim().toLowerCase();
  const typed = words(text);
  if (typed.length === 0) return [];
  const panes = new Map(PANES.filter(shown).map((pane) => [pane.id as string, pane]));
  const found: Array<Found & { rank: number; order: number }> = [];
  let order = 0;
  for (const pane of panes.values()) {
    if (matches(typed, paneWords(pane))) {
      found.push({ id: pane.id, pane: pane.id, label: pane.title, glyph: pane.glyph, rank: rank(pane.title, text, true), order: order++ });
    }
  }
  for (const row of SETTINGS_ROWS) {
    const place = rowPlace(row);
    const pane = panes.get(place.pane);
    if (!pane || !matches(typed, rowWords(row, pane))) continue;
    const label = rowName(row);
    found.push({ id: row.id, pane: pane.id, row: place.row, label, glyph: pane.glyph, rank: rank(label, text, false), order: order++ });
  }
  return found
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, FOUND_MOST)
    .map(({ rank: _rank, order: _order, ...each }) => each);
}

/** The next result `step` away (↑ is -1, ↓ 1), staying inside the list; -1 with none. */
export function moveFound(index: number, step: number, count: number): number {
  if (count === 0) return -1;
  return Math.min(Math.max(index + step, 0), count - 1);
}

/**
 * ❖F (Edit › Find): the search field asks for the keyboard again. Metal has
 * no call that moves the keyboard, so the field is remounted with
 * `autoFocus`, keyed by `getSnapshot()`.
 */
export class FindFocus {
  private serial = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.serial;

  request(): void {
    this.serial++;
    for (const listener of this.listeners) listener();
  }
}
