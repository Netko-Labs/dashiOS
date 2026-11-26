/**
 * The launcher's measures at a text size (Settings › Appearance › Text size;
 * docs/design.html LA-1, TY-1): the field 48 tall with 17 px type, rows 40
 * with the name at 13, what follows at 12 and the kind at 11, heads 22, and
 * every one of them times the text size, so rows grow with their type. The
 * surface is 600 tall at every size, or shorter on a short screen (place.ts);
 * as rows grow or the surface shrinks, fewer of them are listed, so nothing
 * is ever clipped. `measuresFor` is pure; `useMeasures` is what
 * the panel's parts draw with. Its words are TYPE's roles through
 * `typeAt()`, the one reader of the text size (TY-1, TY-3): the field 17,
 * a name 13, what follows 12, the kind 11; the conversation's words are the
 * panel row's (13.5, 12.5, 10.5) and its greeting a heading (15).
 */

import { SPACE, scaled, typeAt, useTextSize } from "@dashi/ui";
import { createContext, useContext } from "react";

/** The launcher's surface: the panel's width, and as tall as its most rows at any text size. */
export const SURFACE = { width: 620, height: 600 } as const;

/** The panel's frame: a 1 px line over the list, 4 px padding inside it, 14 px corners (RA-2: regular glass needs the room, D720). */
export const PANEL = { border: 1, padding: SPACE.xs, radius: 14 } as const;

/** At text size 1 (LA-1): the rows, icons and glyphs, which grow with the type. */
const BASE = { field: 48, row: 40, head: 22, icon: 28, glyph: 16, chip: 26, searchGlyph: 18, emoji: 18 } as const;

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
  /** The conversation's words (13.5), and its quieter line: a step, the greeting's line (12.5). */
  talk: number;
  talkDetail: number;
  /** 12: a fold's count, code, a name over a turn, a button's words. */
  line: number;
  /** 10.5: a key's hint, "Said". */
  micro: number;
  /** 15: the conversation's greeting. */
  greeting: number;
  /** A detail's headings: 17 and 13.5. */
  h1: number;
  h2: number;
  /** An emoji drawn as an app's icon. */
  emoji: number;
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

/** The surface's height on the screen it opened on (place.ts), for the measures of everything drawn in it. */
export const SurfaceHeight = createContext<number>(SURFACE.height);

/** The measures at `textSize` (1 is the standard), on a surface `height` tall. */
export function measuresFor(textSize: number, height: number = SURFACE.height): Measures {
  const at = (px: number) => scaled(px, textSize);
  const type = typeAt(textSize);
  const field = at(BASE.field);
  const row = at(BASE.row);
  const head = at(BASE.head);
  const room = height - field - PANEL.border * 3 - PANEL.padding * 2;
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
    fieldText: type.field.size,
    row,
    head,
    icon: at(BASE.icon),
    glyph: at(BASE.glyph),
    title: type.body.size,
    detail: type.secondary.size,
    small: type.caption.size,
    talk: type.panel.name.size,
    talkDetail: type.panel.body.size,
    line: type.secondary.size,
    micro: type.panel.micro.size,
    greeting: type.heading.size,
    h1: type.field.size,
    h2: type.panel.name.size,
    emoji: at(BASE.emoji),
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

const known = new Map<string, Measures>([[`1:${SURFACE.height}`, STANDARD]]);

/** The measures at the person's text size now, on the surface's height; redraws the caller when it changes. */
export function useMeasures(): Measures {
  const textSize = useTextSize();
  const height = useContext(SurfaceHeight);
  const key = `${textSize}:${height}`;
  let measures = known.get(key);
  if (!measures) {
    measures = measuresFor(textSize, height);
    known.set(key, measures);
  }
  return measures;
}
