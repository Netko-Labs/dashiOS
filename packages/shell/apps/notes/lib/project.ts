/**
 * What a note's field shows: its Markdown drawn as what it means, except the
 * lines that show their source (the block the caret is in, blocks.ts). A
 * drawn heading loses its `#`s, a bullet's dash becomes a dot, a checklist's
 * `- [ ]` a box, `**` and `*` and `` ` `` and a link's address go, a quote
 * loses its `>`, and a rule, a table's rows and a code block's fences give
 * their place to what the page draws under the field (page-under.tsx) in
 * paragraphs of their own. The shown text and the source are laid against
 * each other piece by piece (offsets.ts). Pure.
 */

import { parseTable, type Table } from "../../../src/shared/markdown/index.ts";
import { type Block, blocksOf, type Lines } from "./blocks.ts";
import { BULLET, CHECK, FENCE, HEADING, lineSpans, markup, NUMBER, QUOTE, RULE, type Span } from "./markup.ts";
import { type Piece, toDisplay } from "./offsets.ts";
import { BODY_SIZE, headingSize } from "./sizes.ts";

/** What is drawn differently in the shown text: the source's spans, and the drawn page's own. */
export type Shown =
  | Span
  | { kind: "bullet" | "label" | "rule"; start: number; end: number }
  | { kind: "row"; start: number; end: number; table: number; rows: number };

export type Deco = "none" | "quote" | "code" | "rule" | "table";

/** A paragraph of the shown text: its size and weight (the copy under the field lays it out the same), and what is drawn under it. */
export interface Para {
  size: number;
  bold: boolean;
  deco: Deco;
  /** For `code` and `table`: which block, so the paragraphs of one are drawn as one. */
  group: number;
}

export interface Projection {
  display: string;
  pieces: Piece[];
  spans: Shown[];
  paras: Para[];
  tables: Table[];
}

/** The box a checklist item is drawn with (Inter has both). */
export const BOX = { open: "□", done: "■" } as const;

class Out {
  readonly parts: string[] = [];
  readonly pieces: Piece[] = [];
  /** Spans in source offsets, carried over at the end, and spans already in shown offsets. */
  readonly sourceSpans: Span[] = [];
  readonly shownSpans: Shown[] = [];
  readonly paras: Para[] = [];
  readonly tables: Table[] = [];
  disp = 0;

  keep(src: number, end: number, text: string): void {
    if (end <= src) return;
    const last = this.pieces.at(-1);
    if (last?.kept && last.srcEnd === src) {
      last.srcEnd = end;
      last.dispEnd += end - src;
    } else this.pieces.push({ src, srcEnd: end, disp: this.disp, dispEnd: this.disp + (end - src), kept: true });
    this.parts.push(text);
    this.disp += end - src;
  }

  /** Shows `text` for source `src..end`; gives where it was put. */
  replace(src: number, end: number, text: string): number {
    const at = this.disp;
    this.pieces.push({ src, srcEnd: end, disp: at, dispEnd: at + text.length, kept: false });
    this.parts.push(text);
    this.disp += text.length;
    return at;
  }

  para(size: number, bold: boolean, deco: Deco = "none", group = -1): void {
    this.paras.push({ size, bold, deco, group });
  }
}

/** A line shown as it is typed, its markers faded (the caret's block). */
function sourceLine(out: Out, line: string, start: number, fenced: boolean): void {
  out.keep(start, start + line.length, line);
  const heading = fenced ? null : HEADING.exec(line);
  out.para(heading ? headingSize(heading[1]?.length ?? 1) : BODY_SIZE, heading !== null);
}

/** Where a drawn line's marker goes and what takes its place. */
interface Hide {
  start: number;
  end: number;
  text: string;
  kind?: "bullet" | "box";
}

/** A line drawn as what it means. */
function drawnLine(out: Out, line: string, start: number, index: number): void {
  const end = start + line.length;
  if (RULE.test(line) && line.trim() !== "") {
    const at = out.replace(start, end, " ");
    out.shownSpans.push({ kind: "rule", start: at, end: at + 1 });
    return out.para(BODY_SIZE, false, "rule");
  }
  const spans = lineSpans(line, start, index);
  const hides: Hide[] = [];
  let prefix = start;
  let size = BODY_SIZE;
  let deco: Deco = "none";
  const heading = HEADING.exec(line);
  const check = CHECK.exec(line);
  const bullet = BULLET.exec(line);
  const quote = QUOTE.exec(line);
  if (heading) {
    prefix = start + heading[0].length;
    size = headingSize(heading[1]?.length ?? 1);
    hides.push({ start, end: prefix, text: "" });
  } else if (check) {
    const indent = start + (check[1]?.length ?? 0);
    prefix = start + check[0].length;
    hides.push({ start: indent, end: prefix, text: check[4] === " " ? BOX.open : BOX.done, kind: "box" });
  } else if (bullet) {
    const at = start + (bullet[1]?.length ?? 0);
    prefix = start + bullet[0].length;
    hides.push({ start: at, end: at + 1, text: "•", kind: "bullet" });
  } else if (NUMBER.test(line)) {
    prefix = start + (NUMBER.exec(line)?.[0].length ?? 0);
  } else if (quote) {
    prefix = start + quote[0].length;
    deco = "quote";
    hides.push({ start, end: prefix, text: "" });
  }
  for (const span of spans) {
    if (span.kind === "marker") {
      if (span.start >= prefix) hides.push({ start: span.start, end: span.end, text: "" });
    } else if (span.kind !== "box") out.sourceSpans.push(span);
  }
  hides.sort((a, b) => a.start - b.start);
  let at = start;
  for (const hide of hides) {
    if (hide.start < at) continue;
    out.keep(at, hide.start, line.slice(at - start, hide.start - start));
    const shown = out.replace(hide.start, hide.end, hide.text);
    if (hide.kind === "bullet") out.shownSpans.push({ kind: "bullet", start: shown, end: shown + 1 });
    if (hide.kind === "box") out.shownSpans.push({ kind: "box", start: shown, end: shown + 1, line: index, checked: hide.text === BOX.done });
    at = hide.end;
  }
  out.keep(at, end, line.slice(at - start));
  out.para(size, heading !== null, deco);
}

/** A fenced code block drawn: its language where the opening fence was, its lines as they are, on a panel. */
function drawnFence(out: Out, lines: readonly string[], starts: readonly number[], block: Block, group: number, newline: (line: number) => void): void {
  for (let index = block.from; index <= block.to; index++) {
    const line = lines[index] ?? "";
    const start = starts[index] ?? 0;
    const edge = index === block.from || (index === block.to && FENCE.test(line));
    if (!edge) {
      out.keep(start, start + line.length, line);
      out.para(BODY_SIZE, false, "code", group);
    } else {
      const label = index === block.from ? line.replace(FENCE, "").trim() : "";
      const at = out.replace(start, start + line.length, label);
      if (label !== "") out.shownSpans.push({ kind: "label", start: at, end: at + label.length });
      out.para(label === "" ? BODY_SIZE : 11, false, "code", group);
    }
    newline(index);
  }
}

/** A table drawn: each row's place kept by a space the page sizes to the drawn table's row. */
function drawnTable(out: Out, lines: readonly string[], starts: readonly number[], block: Block, newline: (line: number) => void): void {
  const table = out.tables.length;
  out.tables.push(parseTable(lines.slice(block.from, block.to + 1)));
  const rows = block.to - block.from + 1;
  for (let index = block.from; index <= block.to; index++) {
    const start = starts[index] ?? 0;
    const at = out.replace(start, start + (lines[index] ?? "").length, " ");
    out.shownSpans.push({ kind: "row", start: at, end: at + 1, table, rows });
    out.para(BODY_SIZE, false, "table", table);
    newline(index);
  }
}

/** The shown text of `body` with `revealed` (or nothing) as source. */
export function project(body: string, revealed: Lines | null): Projection {
  const lines = body.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const out = new Out();
  const newline = (index: number): void => {
    const end = (starts[index] ?? 0) + (lines[index] ?? "").length;
    if (index < lines.length - 1) out.keep(end, end + 1, "\n");
  };
  let fences = 0;
  for (const block of blocksOf(lines)) {
    const shown = revealed !== null && block.from <= revealed.to && block.to >= revealed.from;
    if (shown) {
      const from = starts[block.from] ?? 0;
      const to = (starts[block.to] ?? 0) + (lines[block.to] ?? "").length;
      for (const span of markup(body.slice(from, to))) out.sourceSpans.push(shift(span, from, block.from));
      for (let index = block.from; index <= block.to; index++) {
        sourceLine(out, lines[index] ?? "", starts[index] ?? 0, block.kind === "fence");
        newline(index);
      }
    } else if (block.kind === "fence") drawnFence(out, lines, starts, block, fences++, newline);
    else if (block.kind === "table") drawnTable(out, lines, starts, block, newline);
    else {
      drawnLine(out, lines[block.from] ?? "", starts[block.from] ?? 0, block.from);
      newline(block.from);
    }
  }
  const carried = out.sourceSpans.map((span) => ({ ...span, start: toDisplay(out.pieces, span.start), end: toDisplay(out.pieces, span.end) }));
  return { display: out.parts.join(""), pieces: out.pieces, spans: [...carried, ...out.shownSpans], paras: out.paras, tables: out.tables };
}

/** A span of a slice moved to the body's offsets (and a box to the body's lines). */
function shift(span: Span, by: number, lines: number): Span {
  const moved = { ...span, start: span.start + by, end: span.end + by };
  return moved.kind === "box" ? { ...moved, line: moved.line + lines } : moved;
}
