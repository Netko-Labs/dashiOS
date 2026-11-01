/**
 * The arithmetic of tables, apart from drawing them: sorting by a column,
 * what a click on a header does to the sort, and moving the selection with
 * the arrow keys.
 */

export interface SortState {
  key: string;
  ascending: boolean;
}

export interface SortableColumn<T> {
  key: string;
  /** What the cell shows; also what it sorts by without `sortValue`. */
  text: (row: T) => string;
  sortValue?: (row: T) => number | string;
  /** Numbers that matter when large (CPU, memory) sort largest first on the first click. */
  descendingFirst?: boolean;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareValues(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/** `rows` sorted by `sort` (stably: ties keep their order); unsorted when the column is unknown. */
export function sortRows<T>(rows: readonly T[], columns: ReadonlyArray<SortableColumn<T>>, sort: SortState | null): T[] {
  const column = sort ? columns.find((each) => each.key === sort.key) : undefined;
  if (!sort || !column) return [...rows];
  const value = column.sortValue ?? column.text;
  const direction = sort.ascending ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: value(row) }))
    .sort((a, b) => compareValues(a.value, b.value) * direction || a.index - b.index)
    .map(({ row }) => row);
}

/** A click on `column`'s header: sort by it, or flip it when it is already the sort. */
export function nextSort<T>(current: SortState | null, column: SortableColumn<T>): SortState {
  if (current?.key === column.key) return { key: column.key, ascending: !current.ascending };
  return { key: column.key, ascending: column.descendingFirst !== true };
}

/** The row an arrow key selects: the next or previous one, the first or last when nothing is. */
export function moveSelection<K>(keys: readonly K[], selected: K | null, direction: "up" | "down"): K | null {
  if (keys.length === 0) return null;
  const index = selected === null ? -1 : keys.indexOf(selected);
  if (index < 0) return (direction === "down" ? keys[0] : keys[keys.length - 1]) ?? null;
  const next = direction === "down" ? Math.min(index + 1, keys.length - 1) : Math.max(index - 1, 0);
  return keys[next] ?? null;
}
