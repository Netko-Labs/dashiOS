/**
 * How big a dialog's window opens. Metal can't resize a window to its
 * content after it opens, so the size is worked out before, from the text's
 * length and what the dialog holds; `--width` and `--height` win, as in
 * Zenity. The measures here are frame.tsx's, which lays the dialog out.
 */

import type { DialogSpec } from "./spec.ts";

export const LAYOUT = {
  /** AppWindow's toolbar, the one row of chrome (the title). */
  toolbar: 40,
  padding: 18,
  icon: 40,
  gap: 14,
  button: 28,
  line: 17,
  /** A 13 px character's width, on average. */
  char: 6.6,
  field: 28,
  rowHeight: 24,
  tableHeader: 27,
} as const;

export interface Size {
  width: number;
  height: number;
}

const MAX_HEIGHT = 640;
const MAX_WIDTH = 1000;
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** Lines the text takes wrapped to `width`, a paragraph at least one line each. */
export function lineCount(text: string, width: number, noWrap = false): number {
  if (text === "") return 0;
  const perLine = Math.max(Math.floor(width / LAYOUT.char), 1);
  return text.split("\n").reduce((sum, paragraph) => sum + (noWrap ? 1 : Math.max(Math.ceil(paragraph.length / perLine), 1)), 0);
}

const longestLine = (text: string): number => Math.max(0, ...text.split("\n").map((line) => line.length));

/** The window's size for a dialog. `rows` is how many list rows are known at the start. */
export function dialogSize(spec: DialogSpec, rows = 0): Size {
  const { toolbar, padding, icon, gap, button, line, field } = LAYOUT;
  // Everything but the content: the title row, the padding, the buttons.
  const frame = toolbar + padding * 2 + gap + button;
  const fixed = (width: number, content: number): Size => ({
    width: spec.width ?? width,
    height: spec.height ?? clamp(frame + content, 120, MAX_HEIGHT),
  });
  const textHeight = (width: number): number => lineCount(spec.text, width) * line;
  switch (spec.kind) {
    case "info":
    case "warning":
    case "error":
    case "question": {
      const beside = padding * 2 + icon + gap;
      const width = spec.width ?? (spec.noWrap ? clamp(Math.ceil(longestLine(spec.text) * LAYOUT.char) + beside + 12, 320, MAX_WIDTH) : 420);
      // A bold headline sets a little wider; a line of slack covers it.
      const text = lineCount(spec.text, width - beside, spec.noWrap) * line + line;
      return { width, height: spec.height ?? clamp(frame + Math.max(icon, text), 140, MAX_HEIGHT) };
    }
    case "progress":
      return fixed(440, textHeight(440 - padding * 2) + 10 + 6 + (spec.timeRemaining ? line + 6 : 0));
    case "entry":
      return fixed(400, textHeight(400 - padding * 2) + 10 + field);
    case "password":
      return fixed(400, textHeight(400 - padding * 2) + 10 + (spec.username ? (field + line + 6) * 2 : field));
    case "list": {
      const width = spec.width ?? clamp(spec.columns.length * 140, 420, 800);
      const shown = clamp(rows || 8, 4, 12);
      return fixed(width, textHeight(width - padding * 2) + 10 + (spec.hideHeader ? 0 : LAYOUT.tableHeader) + shown * LAYOUT.rowHeight + 2);
    }
    case "text-info":
      return { width: spec.width ?? 560, height: spec.height ?? 440 };
    case "scale":
      return fixed(420, textHeight(420 - padding * 2) + 10 + 24);
    case "calendar":
      return fixed(320, textHeight(320 - padding * 2) + 10 + 28 + 20 + 6 * 28);
  }
}
