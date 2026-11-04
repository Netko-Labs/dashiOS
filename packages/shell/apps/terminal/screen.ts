/**
 * The Terminal's screen: what dashi-term last said to draw. Frames carry the
 * rows that changed (all of them when `full`); this keeps the whole grid, so
 * the view redraws only the rows whose object changed. The wire format is
 * crates/dashi-term/src/protocol.rs; the two change together.
 */

/** A run of cells drawn alike. `fg`/`bg` are `#rrggbb`, or "fg"/"bg" for the terminal's own colors swapped in (inverse video); absent is the default. */
export interface Span {
  s: string;
  fg?: string;
  bg?: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  st?: boolean;
  dim?: boolean;
  sel?: boolean;
}

export interface Cursor {
  x: number;
  y: number;
  visible: boolean;
  style: "block" | "bar" | "underline" | "hollow";
}

export interface Frame {
  cols: number;
  rows: number;
  full: boolean;
  cursor: Cursor;
  lines: { y: number; spans: Span[] }[];
  /** Scrollback: total rows, the view's first row, how many it shows. */
  scroll: [number, number, number];
}

export type EngineMessage =
  | { t: "frame"; frame: Frame }
  | { t: "title"; title: string }
  | { t: "bell" }
  | { t: "copied"; text: string }
  | { t: "exit"; code: number };

export interface Screen {
  cols: number;
  rows: number;
  /** One entry per row; an entry's identity changes only when the row does. */
  lines: Span[][];
  cursor: Cursor;
  scroll: [number, number, number];
}

export const EMPTY_SCREEN: Screen = {
  cols: 0,
  rows: 0,
  lines: [],
  cursor: { x: 0, y: 0, visible: false, style: "block" },
  scroll: [0, 0, 0],
};

const CURSOR_STYLES = new Set(["block", "bar", "underline", "hollow"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSpan(value: unknown): Span | null {
  if (!isRecord(value) || typeof value.s !== "string") return null;
  const span: Span = { s: value.s };
  if (typeof value.fg === "string") span.fg = value.fg;
  if (typeof value.bg === "string") span.bg = value.bg;
  for (const flag of ["b", "i", "u", "st", "dim", "sel"] as const) {
    if (value[flag] === true) span[flag] = true;
  }
  return span;
}

function parseFrame(value: Record<string, unknown>): Frame | null {
  const { cols, rows, full, cursor, lines, scroll } = value;
  if (typeof cols !== "number" || typeof rows !== "number" || !isRecord(cursor) || !Array.isArray(lines)) return null;
  const style = typeof cursor.style === "string" && CURSOR_STYLES.has(cursor.style) ? (cursor.style as Cursor["style"]) : "block";
  const parsedLines = lines.flatMap((line) => {
    if (!isRecord(line) || typeof line.y !== "number" || !Array.isArray(line.spans)) return [];
    return [{ y: line.y, spans: line.spans.flatMap((span) => parseSpan(span) ?? []) }];
  });
  const bar = Array.isArray(scroll) && scroll.length === 3 && scroll.every((n) => typeof n === "number") ? (scroll as [number, number, number]) : [0, 0, 0];
  return {
    cols,
    rows,
    full: full === true,
    cursor: {
      x: typeof cursor.x === "number" ? cursor.x : 0,
      y: typeof cursor.y === "number" ? cursor.y : 0,
      visible: cursor.visible === true,
      style,
    },
    lines: parsedLines,
    scroll: bar as [number, number, number],
  };
}

/** One line from dashi-term, or null if it isn't one it would send. */
export function parseEngineLine(line: string): EngineMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  switch (value.t) {
    case "frame": {
      const frame = parseFrame(value);
      return frame ? { t: "frame", frame } : null;
    }
    case "title":
      return typeof value.title === "string" ? { t: "title", title: value.title } : null;
    case "bell":
      return { t: "bell" };
    case "copied":
      return typeof value.text === "string" ? { t: "copied", text: value.text } : null;
    case "exit":
      return typeof value.code === "number" ? { t: "exit", code: value.code } : null;
    default:
      return null;
  }
}

/** The screen after a frame: changed rows replaced, the grid resized when its size changed. */
export function applyFrame(screen: Screen, frame: Frame): Screen {
  const resized = frame.cols !== screen.cols || frame.rows !== screen.rows;
  const lines = resized || frame.full ? Array.from({ length: frame.rows }, (_, y) => (resized ? [] : (screen.lines[y] ?? []))) : [...screen.lines];
  for (const line of frame.lines) {
    if (line.y >= 0 && line.y < frame.rows) lines[line.y] = line.spans;
  }
  return { cols: frame.cols, rows: frame.rows, lines, cursor: frame.cursor, scroll: frame.scroll };
}

/** The grid a pixel area holds, at least 2 × 1. */
export function gridFor(width: number, height: number, cellWidth: number, cellHeight: number): { cols: number; rows: number } {
  if (cellWidth <= 0 || cellHeight <= 0) return { cols: 80, rows: 24 };
  return { cols: Math.max(2, Math.floor(width / cellWidth)), rows: Math.max(1, Math.floor(height / cellHeight)) };
}

/** The cell under a point in the grid's own pixels, clamped to the grid. */
export function cellAt(x: number, y: number, cellWidth: number, cellHeight: number, cols: number, rows: number): { x: number; y: number } {
  const clamp = (n: number, max: number): number => Math.min(Math.max(n, 0), Math.max(max - 1, 0));
  return { x: clamp(Math.floor(x / cellWidth), cols), y: clamp(Math.floor(y / cellHeight), rows) };
}

/** What the title bar says: the program's title and, once it is known, the grid ("dashi@dashi:~ — 96×24"). */
export function terminalTitle(title: string, cols: number, rows: number): string {
  return cols > 0 ? `${title} — ${cols}×${rows}` : title;
}
