/**
 * A Markdown table (GitHub's): a header row, a row of dashes that sets each
 * column's alignment, and the rows under it, each cell between pipes. The
 * note keeps the pipes; the page draws the cells. Pure.
 */

export type Align = "left" | "center" | "right";

export interface Table {
  header: string[];
  align: Align[];
  rows: string[][];
}

/** A row's cells, trimmed: the pipes at its ends are optional, and `\|` is a pipe inside a cell. */
export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === "\\" && text[at + 1] === "|") {
      cell += "|";
      at++;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

const DASHES = /^:?-+:?$/;

/** The row of dashes under a header (`| --- | :-: |`): at least one pipe, every cell dashes with optional colons. */
export function isSeparator(line: string): boolean {
  if (!line.includes("|") && !/^\s*:?-+:?\s*$/.test(line)) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => DASHES.test(cell));
}

/** Whether `lines[at]` starts a table: a row with a pipe, and the dashes under it with as many cells. */
export function startsTable(lines: readonly string[], at: number): boolean {
  const head = lines[at];
  const rule = lines[at + 1];
  if (head === undefined || rule === undefined || !head.includes("|") || !rule.includes("|")) return false;
  return isSeparator(rule) && splitRow(rule).length === splitRow(head).length;
}

/** Whether `line` goes on a table above it: it has words and a pipe. */
export const continuesTable = (line: string): boolean => line.trim() !== "" && line.includes("|");

/** The table in `lines` (the header, the dashes, the rows); every row has the header's number of cells. */
export function parseTable(lines: readonly string[]): Table {
  const header = splitRow(lines[0] ?? "");
  const align = splitRow(lines[1] ?? "").map((cell): Align => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : "left";
  });
  const fit = (cells: string[]): string[] => Array.from({ length: header.length }, (_, index) => cells[index] ?? "");
  return { header, align: fit(align) as Align[], rows: lines.slice(2).map((line) => fit(splitRow(line))) };
}

/** A column's share of the width (its longest cell, between 4 and 40 letters, so a long one wraps) and the letters it never goes under (its longest word, so no word breaks). */
export interface Column {
  weight: number;
  floor: number;
}

/** Each column's measure, of its words as drawn (`words`: a link is its words, not its address). */
export function columnsOf(table: Table, words: (cell: string) => string = (cell) => cell): Column[] {
  return table.header.map((cell, column) => {
    const cells = [cell, ...table.rows.map((row) => row[column] ?? "")].map(words);
    const longest = Math.max(...cells.map((each) => each.length));
    const word = Math.max(...cells.flatMap((each) => each.split(/\s+/).map((part) => part.length)));
    return { weight: Math.min(40, Math.max(4, longest)), floor: Math.min(24, word) };
  });
}
