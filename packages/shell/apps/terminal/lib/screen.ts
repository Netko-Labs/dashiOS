/**
 * The Terminal's screen: what dashi-term last said to draw. Frames carry the
 * rows that changed (all of them when `full`); this keeps the whole grid, so
 * the view redraws only the rows whose object changed. The wire format is
 * crates/dashi-term/src/protocol.rs; the two change together.
 */

/**
 * A run of cells drawn alike, from column `x`, `w` cells wide: it is drawn
 * at that column whatever its glyphs' own widths, so an emoji or a CJK
 * character (two cells, a span of its own) never shifts the rest of the row.
 * `fg`/`bg` are `#rrggbb`, or "fg"/"bg" for the terminal's own colors swapped
 * in (inverse video); absent is the default.
 */
export interface Span {
  s: string;
  x: number;
  w: number;
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

/** A command's prompt row in view (the shell integration's marks), and whether the command failed. */
export interface Mark {
  y: number;
  failed: boolean;
}

export interface Frame {
  cols: number;
  rows: number;
  full: boolean;
  /** The terminal's ink and ground as they are now (the app's palette, or a program's OSC 10/11); absent until either is set. */
  ink?: string;
  ground?: string;
  cursor: Cursor;
  lines: { y: number; spans: Span[] }[];
  /** Scrollback: total rows, the view's first row, how many it shows. */
  scroll: [number, number, number];
  /** Something is selected, in view or not. */
  selected: boolean;
  marks: Mark[];
}

export type EngineMessage =
  | { t: "frame"; frame: Frame }
  | { t: "title"; title: string }
  | { t: "bell" }
  | { t: "copied"; text: string }
  | { t: "exit"; code: number }
  /** In reply to `running`: the foreground program's name ("" when it has none), or null at the shell's prompt. */
  | { t: "running"; program: string | null }
  /** The shell's folder (OSC 7), and the host it named ("" for none). */
  | { t: "cwd"; path: string; host: string }
  /** The shell drew a prompt: nothing runs in front of it. */
  | { t: "prompt" }
  /** A command started, with its command line ("" when the shell didn't send it). */
  | { t: "command"; command: string }
  /** The command ended, with its status when the shell sent it. */
  | { t: "done"; code: number | null }
  /** The engine went away without saying the shell exited (engine.ts says this, not dashi-term). */
  | { t: "gone" };

export interface Screen {
  cols: number;
  rows: number;
  /** One entry per row; an entry's identity changes only when the row does. */
  lines: Span[][];
  cursor: Cursor;
  scroll: [number, number, number];
  /** The terminal's own ink and ground, when it has said them (Frame). */
  ink?: string;
  ground?: string;
  selected: boolean;
  marks: Mark[];
}

export const EMPTY_SCREEN: Screen = {
  cols: 0,
  rows: 0,
  lines: [],
  cursor: { x: 0, y: 0, visible: false, style: "block" },
  scroll: [0, 0, 0],
  selected: false,
  marks: [],
};

const CURSOR_STYLES = new Set(["block", "bar", "underline", "hollow"]);
const HEX = /^#[0-9a-f]{6}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A span; `at` is the column after the previous one, for an older engine that sent no `x` and `w` (one cell a character). */
function parseSpan(value: unknown, at: number): Span | null {
  if (!isRecord(value) || typeof value.s !== "string") return null;
  const x = typeof value.x === "number" ? value.x : at;
  const w = typeof value.w === "number" ? value.w : Array.from(value.s).length;
  const span: Span = { s: value.s, x, w };
  if (typeof value.fg === "string") span.fg = value.fg;
  if (typeof value.bg === "string") span.bg = value.bg;
  for (const flag of ["b", "i", "u", "st", "dim", "sel"] as const) {
    if (value[flag] === true) span[flag] = true;
  }
  return span;
}

function parseSpans(values: unknown[]): Span[] {
  const spans: Span[] = [];
  for (const value of values) {
    const last = spans[spans.length - 1];
    const span = parseSpan(value, last ? last.x + last.w : 0);
    if (span) spans.push(span);
  }
  return spans;
}

function parseMarks(value: unknown): Mark[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((mark) => (isRecord(mark) && typeof mark.y === "number" ? [{ y: mark.y, failed: mark.failed === true }] : []));
}

function parseFrame(value: Record<string, unknown>): Frame | null {
  const { cols, rows, full, cursor, lines, scroll } = value;
  if (typeof cols !== "number" || typeof rows !== "number" || !isRecord(cursor) || !Array.isArray(lines)) return null;
  const style = typeof cursor.style === "string" && CURSOR_STYLES.has(cursor.style) ? (cursor.style as Cursor["style"]) : "block";
  const parsedLines = lines.flatMap((line) => {
    if (!isRecord(line) || typeof line.y !== "number" || !Array.isArray(line.spans)) return [];
    return [{ y: line.y, spans: parseSpans(line.spans) }];
  });
  const [top, shown, total]: unknown[] = Array.isArray(scroll) && scroll.length === 3 ? scroll : [];
  const bar: [number, number, number] = typeof top === "number" && typeof shown === "number" && typeof total === "number" ? [top, shown, total] : [0, 0, 0];
  return {
    cols,
    rows,
    full: full === true,
    ...(typeof value.ink === "string" && HEX.test(value.ink) ? { ink: value.ink } : {}),
    ...(typeof value.ground === "string" && HEX.test(value.ground) ? { ground: value.ground } : {}),
    cursor: {
      x: typeof cursor.x === "number" ? cursor.x : 0,
      y: typeof cursor.y === "number" ? cursor.y : 0,
      visible: cursor.visible === true,
      style,
    },
    lines: parsedLines,
    scroll: bar,
    selected: value.selected === true,
    marks: parseMarks(value.marks),
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
    case "running":
      return value.program === null || typeof value.program === "string" ? { t: "running", program: value.program } : null;
    case "cwd":
      return typeof value.path === "string" ? { t: "cwd", path: value.path, host: typeof value.host === "string" ? value.host : "" } : null;
    case "prompt":
      return { t: "prompt" };
    case "command":
      return { t: "command", command: typeof value.command === "string" ? value.command : "" };
    case "done":
      return { t: "done", code: typeof value.code === "number" ? value.code : null };
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
  const colors = { ...(frame.ink ? { ink: frame.ink } : {}), ...(frame.ground ? { ground: frame.ground } : {}) };
  // The marks keep their identity while they don't move, so the margin doesn't redraw.
  const marks = sameMarks(screen.marks, frame.marks) ? screen.marks : frame.marks;
  return { cols: frame.cols, rows: frame.rows, lines, cursor: frame.cursor, scroll: frame.scroll, selected: frame.selected, marks, ...colors };
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((mark, index) => mark.y === b[index]?.y && mark.failed === b[index]?.failed);
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

/**
 * What is drawn at column `x` of a row: the span over it and that cell's
 * text (a whole span when it is one character two cells wide), so the
 * cursor can draw the letter under it in the ground's color. Null on an empty cell.
 */
export function cellText(spans: readonly Span[], x: number): { span: Span; text: string } | null {
  const span = spans.find((each) => x >= each.x && x < each.x + each.w);
  if (!span) return null;
  const chars = Array.from(span.s);
  // A run is one character a cell; anything else is one cell or one wide character.
  const text = chars.length === span.w ? (chars[x - span.x] ?? "") : span.s;
  return text.trim() === "" ? null : { span, text };
}

/** Scrolled back: the view isn't on the last row of the scrollback. */
export function scrolledBack(scroll: readonly [number, number, number]): boolean {
  const [total, offset, len] = scroll;
  return offset + len < total;
}
