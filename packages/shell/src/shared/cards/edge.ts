/**
 * One left edge (docs/design.html, "Settings", SE-6): in a card, either
 * every row has its knob glyph or none does, so the titles of a card start
 * at one place. Main settings rows have glyphs; plain lists (devices,
 * networks, a history) and cards of plain facts have none. Each card
 * (cards.tsx `Group`) hears which of its rows have a knob (row.tsx) and tells
 * `onMixedCard`'s listeners when they disagree: the test that draws the
 * panes listens, and nothing is drawn differently.
 */

import { createContext } from "react";

/** Whether a card's rows keep one left edge: all with a knob, or none. */
export function oneLeftEdge(knobs: readonly boolean[]): boolean {
  return knobs.every((knob) => knob) || knobs.every((knob) => !knob);
}

/** What a card gives its rows: a row says whether it has a knob, and takes it back when it goes. */
export interface CardRows {
  report(row: symbol, knob: boolean): () => void;
}

export const CardRowsContext = createContext<CardRows | null>(null);

const listeners = new Set<(card: string) => void>();

/** Hear of a card whose rows start at two edges (by its testID, or "card"); returns what stops hearing. */
export function onMixedCard(listener: (card: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A card's rows as they report: tells the listeners when they stop keeping one edge. */
export function cardRows(card: string): CardRows {
  const rows = new Map<symbol, boolean>();
  const check = (): void => {
    if (oneLeftEdge([...rows.values()])) return;
    for (const listener of listeners) listener(card);
  };
  return {
    report(row, knob) {
      rows.set(row, knob);
      check();
      return () => {
        rows.delete(row);
      };
    },
  };
}
