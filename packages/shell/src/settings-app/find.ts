/**
 * Search in System Settings' sidebar: what is typed finds panes and the
 * rows in them, from the settings registry (registry/) and the panes' words
 * (search.ts), so a row added to a pane is found here as it is in the
 * launcher. The sidebar lists what was found in place of the panes; choosing
 * one opens its pane, scrolled to the row and lit (spot.tsx).
 *
 * Every word typed must start a word of the title, the name, the pane, or a
 * keyword: "night" finds Night Shift, "charge" the charge limit. A title
 * that starts with what was typed comes first, then one that holds it, then
 * a pane, then a row found by its other words.
 *
 * One result per setting: a row that is part of another (Night Shift's
 * hours and warmth, the charge limit's slider: the registry's `partOf`) is
 * listed only when the words find it and not its setting, and then once.
 * A row's result carries its own glyph (its pane's when it has none) and
 * the name of the pane it is in.
 *
 * Rows that come and go are found too (`LiveRow`): each app playing sound
 * by its name ("Helium" finds its row in Sound's Apps card).
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
  /** The row's glyph, else its pane's. */
  glyph: string;
  /** The pane a row is in, by its title, said after the row; absent for a pane. */
  where?: string;
}

/** A row that is there only for now (an app playing sound): found by its name, opened at its own Spot. */
export interface LiveRow {
  pane: PaneId;
  /** The row's part after the pane ("apps/helium"): its Spot's. */
  row: string;
  label: string;
  /** Other words it answers to. */
  keywords: readonly string[];
}

/** Each app with a row in Sound's Apps card, as a live row (sound-apps.tsx gives each its Spot, `appSpot`). */
export const appRows = (apps: readonly { key: string; name: string }[]): LiveRow[] =>
  apps.map((app) => ({ pane: "sound", row: rowPlace({ id: appSpot(app.key) }).row, label: app.name, keywords: ["app volume", "playing"] }));

/** The Spot of an app's row in Sound's Apps card. */
export const appSpot = (key: string): AppSpotId => `sound/apps/${key}`;

export type AppSpotId = `sound/apps/${string}`;

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
export function findSettings(query: string, shown: (pane: PaneInfo) => boolean = () => true, live: readonly LiveRow[] = []): Found[] {
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
  /** The best row found for each setting, by the setting's id. */
  const settings = new Map<string, Found & { rank: number; order: number; whole: boolean }>();
  for (const row of SETTINGS_ROWS) {
    const place = rowPlace(row);
    const pane = panes.get(place.pane);
    if (!pane || !matches(typed, rowWords(row, pane))) continue;
    const label = rowName(row);
    const each = {
      id: row.id,
      pane: pane.id,
      row: place.row,
      label,
      glyph: row.glyph ?? pane.glyph,
      where: pane.title,
      rank: rank(label, text, false),
      order: order++,
      whole: row.partOf === undefined,
    };
    const setting = row.partOf ?? row.id;
    const kept = settings.get(setting);
    // The setting itself wins over its parts; among parts, the better rank.
    if (!kept || (each.whole && !kept.whole) || (each.whole === kept.whole && each.rank < kept.rank)) settings.set(setting, each);
  }
  for (const { whole: _whole, ...each } of settings.values()) found.push(each);
  for (const row of live) {
    const pane = panes.get(row.pane);
    if (!pane || !matches(typed, [...words(row.label), ...row.keywords.flatMap(words), ...words(pane.title)])) continue;
    found.push({
      id: `${pane.id}/${row.row}`,
      pane: pane.id,
      row: row.row,
      label: row.label,
      glyph: pane.glyph,
      where: pane.title,
      rank: rank(row.label, text, false),
      order: order++,
    });
  }
  // A pane's own switch, named as the pane ("Bluetooth"), is the pane's result: one setting, listed once.
  return found
    .filter(
      (each) => each.row === undefined || !(panes.has(each.pane) && each.label === panes.get(each.pane)?.title && found.some((pane) => pane.id === each.pane)),
    )
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
