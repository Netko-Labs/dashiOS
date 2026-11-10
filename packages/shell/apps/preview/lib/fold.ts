/**
 * Preview's toolbar in a narrow window: what doesn't fit folds into the "…"
 * menu, the least important first, so nothing is ever cut at the window's
 * edge (a rotate button half drawn). Pure: the view measures the room its
 * toolbar has and shows what this picks; the rest are rows of "…".
 *
 * The tools, in the order they are drawn: Previous and Next (with a PDF's
 * "3 / 12"), Zoom Out, the zoom level and Zoom In, Zoom to Fit, Actual Size,
 * the two turns, Info; then "…", which always stays. They fold in the
 * reverse of how much they are reached for: Actual Size, Zoom to Fit, Info,
 * the turns, the zoom, and moving last. Each keeps its keys in the menu bar
 * and shows them in "…".
 *
 * The file's name shares the row (planToolbar): the quiet size words go
 * first, then the name gives way, down to a floor, with an ellipsis; only
 * then does a tool fold.
 */

import { fitDetail, textWidth } from "./detail.ts";

/** The toolbar's labels are 12 px (toolbar.tsx). */
const LABEL_SIZE = 12;

export type ToolId = "move" | "zoom" | "fit" | "actual" | "turn" | "info";

/** The tools in the order they are drawn. */
export const TOOLS: readonly ToolId[] = ["move", "zoom", "fit", "actual", "turn", "info"];

/** The order they fold in, the least important first. */
export const FOLD_ORDER: readonly ToolId[] = ["actual", "fit", "info", "turn", "zoom", "move"];

/** The toolbar's measures (@dashi/ui window.tsx): a glyph button, the row's gap, a divider with its margins, the labels' least widths. */
export const MEASURES = { button: 32, gap: 10, divider: 7, position: 44, zoomLevel: 46 } as const;

/** Tools drawn between the same dividers. */
const GROUP: Readonly<Record<ToolId, number>> = { move: 0, zoom: 1, fit: 1, actual: 1, turn: 2, info: 3 };

/** A label's width: its least, or its words at 12 px when they are wider ("118 / 240"). */
const labelWidth = (text: string, least: number): number => Math.max(least, Math.ceil(textWidth(text, LABEL_SIZE)));

/** How wide each tool is drawn: the PDF's page ("3 / 12") and the zoom level ("43%") are there only when shown. */
export function toolWidths(labels: { position: string | null; zoomLevel: string | null }): Record<ToolId, number> {
  const { button, gap } = MEASURES;
  return {
    move: button * 2 + gap + (labels.position ? labelWidth(labels.position, MEASURES.position) + gap : 0),
    zoom: button * 2 + gap + (labels.zoomLevel ? labelWidth(labels.zoomLevel, MEASURES.zoomLevel) + gap : 0),
    fit: button,
    actual: button,
    turn: button * 2 + gap,
    info: button,
  };
}

/** How wide `shown` (in drawing order) and "…" are, with the gaps and the dividers between groups. */
export function toolbarWidth(shown: readonly ToolId[], widths: Readonly<Record<ToolId, number>>): number {
  const { button, gap, divider } = MEASURES;
  let width = button;
  shown.forEach((tool, index) => {
    width += widths[tool] + gap;
    const previous = shown[index - 1];
    if (previous !== undefined && GROUP[previous] !== GROUP[tool]) width += divider + gap;
  });
  return width;
}

export interface Fold {
  /** What the toolbar draws, in drawing order. */
  shown: ToolId[];
  /** What "…" lists first, in drawing order. */
  folded: ToolId[];
  /** How wide the toolbar is drawn, "…" included. */
  width: number;
}

/** What fits in `room` px; null `room` (not measured yet) shows everything. */
export function foldTools(room: number | null, widths: Readonly<Record<ToolId, number>>): Fold {
  let shown = [...TOOLS];
  if (room !== null) {
    for (const tool of FOLD_ORDER) {
      if (toolbarWidth(shown, widths) <= room) break;
      shown = shown.filter((each) => each !== tool);
    }
  }
  return { shown, folded: TOOLS.filter((tool) => !shown.includes(tool)), width: toolbarWidth(shown, widths) };
}

/** Whether a divider goes before `tool` in `shown`: it starts a group after another one. */
export function dividerBefore(shown: readonly ToolId[], tool: ToolId): boolean {
  const index = shown.indexOf(tool);
  const previous = index > 0 ? shown[index - 1] : undefined;
  return previous !== undefined && GROUP[previous] !== GROUP[tool];
}

/** The title's type (@dashi/ui window.tsx): 13 px bold. Bold runs a little wider than textWidth's estimate. */
const TITLE_SIZE = 13;
const BOLD = 1.06;
/** The widest the name gets (@dashi/ui window.tsx TITLE_MAX), and the least it keeps before a tool folds. */
export const TITLE_MAX = 320;
export const TITLE_FLOOR = 120;
/** The spinner beside the words while Preview is busy. */
const SPINNER = 16;

/** About how wide the window's name is drawn, whole. */
export const titleWidth = (title: string): number => Math.ceil(textWidth(title, TITLE_SIZE) * BOLD);

export interface ToolbarPlan extends Fold {
  /** The most the name may take (it ends in an ellipsis when it needs more); 0 when the compositor draws it. */
  title: number;
  /** The size words that fit what is left, or null. */
  detail: string | null;
}

/**
 * The whole chrome row in `room` px (the name, the size words, the tools and
 * "…"; null before it is measured). The name keeps its width while the words
 * give way; past that it shortens down to TITLE_FLOOR (its own width when it
 * is shorter), and only then do tools fold, the least important first. The
 * name then takes back what the folding freed, never more than it needs.
 */
export function planToolbar(
  room: number | null,
  { title, widths, detail, busy }: { title: string | null; widths: Readonly<Record<ToolId, number>>; detail: readonly string[]; busy: boolean },
): ToolbarPlan {
  const { gap } = MEASURES;
  const want = title === null ? 0 : Math.min(titleWidth(title), TITLE_MAX);
  if (room === null) return { ...foldTools(null, widths), title: want, detail: null };
  const named = want > 0 ? gap : 0;
  const spinner = busy ? SPINNER + gap : 0;
  const floor = Math.min(want, TITLE_FLOOR);
  const fold = foldTools(room - floor - named - spinner, widths);
  const name = Math.max(0, Math.min(want, room - fold.width - named - spinner));
  const words = fitDetail(detail, room - name - named - spinner - fold.width - gap);
  return { ...fold, title: name, detail: words };
}
