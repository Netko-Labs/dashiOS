/**
 * `--list` apart from drawing it: the cells (from the command line, or one
 * per stdin line) made into rows of the columns' width, which rows a
 * checklist or radiolist starts with ticked (a first cell of TRUE), and what
 * is printed on OK: the chosen rows' `--print-column`, everything joined by
 * `--separator`, as Zenity prints it.
 */

export interface ListRow {
  /** Stable for the life of the dialog: the row's place in the input. */
  id: number;
  cells: string[];
}

/** The cells, row by row; a short last row is padded with empty cells. */
export function rowsFrom(cells: readonly string[], columns: number): ListRow[] {
  if (columns <= 0) return [];
  const rows: ListRow[] = [];
  for (let at = 0; at < cells.length; at += columns) {
    const row = cells.slice(at, at + columns);
    while (row.length < columns) row.push("");
    rows.push({ id: rows.length, cells: row });
  }
  return rows;
}

/** A checklist's or radiolist's first cell: ticked when it says TRUE, in any case. */
export const isTicked = (cell: string | undefined): boolean => cell?.trim().toUpperCase() === "TRUE";

/** The rows ticked at the start: every TRUE for a checklist, the first for a radiolist. */
export function initialTicks(rows: readonly ListRow[], mode: "checklist" | "radiolist"): Set<number> {
  const ticked = rows.filter((row) => isTicked(row.cells[0])).map((row) => row.id);
  return new Set(mode === "radiolist" ? ticked.slice(0, 1) : ticked);
}

export interface OutputOptions {
  printColumns: readonly number[] | "all";
  separator: string;
  /** The first column is the tick box (a checklist or radiolist). */
  toggles: boolean;
}

/** One chosen row's printed values. "ALL" skips the tick box column; a ticked box prints as TRUE. */
function valuesOf(row: ListRow, options: OutputOptions): string[] {
  const all = row.cells.map((_, index) => index + 1);
  const columns = options.printColumns === "all" ? all.filter((column) => !(options.toggles && column === 1)) : options.printColumns;
  return columns.filter((column) => column <= row.cells.length).map((column) => (options.toggles && column === 1 ? "TRUE" : (row.cells[column - 1] ?? "")));
}

/** What OK prints for the chosen rows (in the list's order), or null when none is chosen: Zenity prints nothing then. */
export function listOutput(rows: readonly ListRow[], chosen: ReadonlySet<number>, options: OutputOptions): string | null {
  const picked = rows.filter((row) => chosen.has(row.id));
  if (picked.length === 0) return null;
  return `${picked.flatMap((row) => valuesOf(row, options)).join(options.separator)}\n`;
}

/** The columns drawn: every one but `--hide-column`'s, as 0-based indexes. */
export function shownColumns(count: number, hidden: readonly number[]): number[] {
  const skip = new Set(hidden);
  return Array.from({ length: count }, (_, index) => index).filter((index) => !skip.has(index + 1));
}
