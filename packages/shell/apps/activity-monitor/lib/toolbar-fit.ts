/**
 * How the toolbar's one row gives way in a narrow window, in a fixed order,
 * so no control is ever cut or pushed off the edge: the title goes first,
 * then Quit's words (its glyph stays), then the search field becomes a
 * glyph that opens it in the tabs' place, then the tabs narrow, then the
 * view button keeps only its glyph, then the tabs narrow once more. Each
 * step is a whole layout with every slot a fixed width, so nothing moves
 * when a label changes. The widths lean wide (measured in the VM at the
 * default text size); `TOOLBAR_MIN_WIDTH` is the window's least width.
 */

import { TABS } from "./menus.ts";

export const TOOLBAR = {
  /** Between the toolbar's items (dashi-ui window.tsx). */
  gap: 10,
  /** "Activity Monitor", bold 13. */
  title: 108,
  /** Quit… with its glyph. */
  quitLabel: 74,
  /** A glyph-only toolbar button. */
  icon: 32,
  /** The view button at its longest label, "All processes ▼" (it keeps that width for every label). */
  viewLabel: 100,
  /** The search field: its text gets this less `SEARCH_CHROME`, room for "NetworkManager" (107 pt in the VM) beside the clear button. */
  search: 168,
  /** The segmented control's padding and the gaps between its segments. */
  tabsChrome: 4 + 2 * (TABS.length - 1),
  /** After the controls: the toolbar's right padding. */
  end: 12,
} as const;

/** A SearchField's own room around its text (dashi-ui fields.tsx): padding 12, the magnifier 13, two gaps 8, the clear button 18, the input's padding 4. */
export const SEARCH_CHROME = 55;

export interface ToolbarFit {
  title: boolean;
  quitLabel: boolean;
  viewLabel: boolean;
  /** The search field itself; else a glyph that opens it over the tabs. */
  searchField: boolean;
  segment: number;
}

const FULL: ToolbarFit = { title: true, quitLabel: true, viewLabel: true, searchField: true, segment: 64 };

/** Each step gives up one more thing than the one before. */
export const TOOLBAR_STEPS: readonly ToolbarFit[] = [
  FULL,
  { ...FULL, title: false },
  { ...FULL, title: false, quitLabel: false },
  { ...FULL, title: false, quitLabel: false, searchField: false },
  { ...FULL, title: false, quitLabel: false, searchField: false, segment: 56 },
  { ...FULL, title: false, quitLabel: false, searchField: false, segment: 56, viewLabel: false },
  { ...FULL, title: false, quitLabel: false, searchField: false, segment: 52, viewLabel: false },
];

/** The tabs' width with `segment`-wide segments. */
export const tabsWidth = (segment: number): number => segment * TABS.length + TOOLBAR.tabsChrome;

/** The row's controls laid out as `fit` says, title and gaps included (not the toolbar's own padding). */
export function toolbarWidth(fit: ToolbarFit): number {
  const { gap, title, quitLabel, icon, viewLabel, search } = TOOLBAR;
  // Quit, the view button, the tabs and search, after the title (or the space in its place): four gaps, five with the title.
  return (
    (fit.title ? title + gap : 0) +
    4 * gap +
    (fit.quitLabel ? quitLabel : icon) +
    (fit.viewLabel ? viewLabel : icon) +
    tabsWidth(fit.segment) +
    (fit.searchField ? search : icon)
  );
}

/** The first step whose row fits `room` (the toolbar's width less its padding); the last one when none does. */
export function toolbarFit(room: number): ToolbarFit {
  return TOOLBAR_STEPS.find((fit) => toolbarWidth(fit) <= room) ?? (TOOLBAR_STEPS.at(-1) as ToolbarFit);
}

/** The toolbar's room in a window `width` wide: less the window controls' inset (or 18 without them) and the end padding. */
export function toolbarRoom(width: number, leading: number): number {
  return width - (leading > 0 ? leading + 14 : 18) - TOOLBAR.end;
}

/** The least width the window takes: the last step's row, its padding, and a little to spare. */
export const TOOLBAR_MIN_WIDTH = 520;
