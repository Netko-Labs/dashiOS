/**
 * The launcher's measures at a text size (Settings › Appearance › Text size;
 * docs/design.html LA-1, TY-1): the field 48 tall with 17 px type, rows 40
 * with the name at 13, what follows at 12 and the kind at 11, heads 22, and
 * every one of them times the text size, so rows grow with their type. The
 * surface is 600 tall at every size; as rows grow, fewer of them are listed,
 * so nothing is ever clipped. `measuresFor` is pure; `useMeasures` is what
 * the panel's parts draw with.
 */

import { scaled, useTextSize } from "@dashi/ui";

/** The launcher's surface: the panel's width, and as tall as its most rows at any text size. */
export const SURFACE = { width: 620, height: 600 } as const;

/** The panel's frame: a 1 px border all round (and over the list), 5 px padding inside the list, 12 px corners. */
export const PANEL = { border: 1, padding: 5, radius: 12 } as const;

/** At text size 1 (LA-1, TY-1). */
const BASE = { field: 48, fieldText: 17, row: 40, head: 22, icon: 28, glyph: 16, title: 13, detail: 12, small: 11, chip: 26, searchGlyph: 18 } as const;

/** At most, at any size: the answer and what the ranking found; files; rows of a plain list (All apps). */
const MOST = { local: 5, files: 3, allApps: 8 } as const;
/** At least, however large the type. */
const FEWEST = { local: 3, files: 1 } as const;

export interface Measures {
  textSize: number;
  field: number;
  fieldText: number;
  row: number;
  head: number;
  icon: number;
  glyph: number;
  /** The row's name, the chip's words. */
  title: number;
  /** What follows the name; a value. */
  detail: number;
  /** The kind, a head, a key, a hint. */
  small: number;
  chip: number;
  searchGlyph: number;
  /** Instant rows listed (the answer included), and file rows under them. */
  localRows: number;
  fileRows: number;
  /** Rows of a list with one head (Recent, All apps, the action list). */
  listRows: number;
  /** All apps drawn at once; the selection scrolls them. */
  allAppsRows: number;
  /** Height the list has for its rows and heads, under the field. */
  room: number;
}

/** The tallest the instant rows and the files get: every row, a head per local row (Top hit and each kind), and the files' head. */
export function tallest(local: number, files: number, row: number, head: number): number {
  return (local + files) * row + (local + 1) * head;
}

/** The measures at `textSize` (1 is the standard). */
export function measuresFor(textSize: number): Measures {
  const at = (px: number) => scaled(px, textSize);
  const field = at(BASE.field);
  const row = at(BASE.row);
  const head = at(BASE.head);
  const room = SURFACE.height - field - PANEL.border * 3 - PANEL.padding * 2;
  // The most rows that fit, then the most of them instant.
  let best: { local: number; files: number } = { local: FEWEST.local, files: FEWEST.files };
  for (let local = MOST.local; local >= FEWEST.local; local--) {
    for (let files = MOST.files; files >= FEWEST.files; files--) {
      const fits = tallest(local, files, row, head) <= room;
      if (fits && local + files > best.local + best.files) best = { local, files };
    }
  }
  const listRows = Math.max(1, Math.floor((room - head) / row));
  return {
    textSize,
    field,
    fieldText: at(BASE.fieldText),
    row,
    head,
    icon: at(BASE.icon),
    glyph: at(BASE.glyph),
    title: at(BASE.title),
    detail: at(BASE.detail),
    small: at(BASE.small),
    chip: at(BASE.chip),
    searchGlyph: at(BASE.searchGlyph),
    localRows: best.local,
    fileRows: best.files,
    listRows,
    allAppsRows: Math.min(MOST.allApps, listRows),
    room,
  };
}

/** The measures at text size 1. */
export const STANDARD = measuresFor(1);

const known = new Map<number, Measures>([[1, STANDARD]]);

/** The measures at the person's text size now; redraws the caller when it changes. */
export function useMeasures(): Measures {
  const textSize = useTextSize();
  let measures = known.get(textSize);
  if (!measures) {
    measures = measuresFor(textSize);
    known.set(textSize, measures);
  }
  return measures;
}
