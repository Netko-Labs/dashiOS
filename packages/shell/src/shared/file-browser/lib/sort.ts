/** Sorting a listing: folders stay on top, whatever the column, as in most file managers. */

import { type Column, type SortState, sortRows } from "@dashi/ui";
import { type FileItem, kindText } from "../../files/index.ts";
import { formatDate, formatSize } from "../format.ts";

export type FileColumn = Column<FileItem>;

/** What the list shows columns for: a folder, a list of places (search, Recents), or the Trash. */
export type ColumnMode = "folder" | "locations" | "trash";

export function columnMode(state: { found: unknown; location: { kind: string } }): ColumnMode {
  if (state.found !== null) return "locations";
  return state.location.kind === "trash" ? "trash" : state.location.kind === "recents" ? "locations" : "folder";
}

/** The list view's columns, without their cells (the view draws the name with its icon). */
export function fileColumns(mode: ColumnMode | boolean): FileColumn[] {
  const kind = mode === true ? "locations" : mode === false ? "folder" : mode;
  const inLocations = kind !== "folder";
  return [
    { key: "name", title: "Name", text: (item) => item.name },
    kind === "trash"
      ? {
          key: "deleted",
          title: "Date Deleted",
          width: 150,
          text: (item) => formatDate(item.deleted ?? item.mtime),
          sortValue: (item) => item.deleted ?? item.mtime,
          descendingFirst: true,
        }
      : { key: "modified", title: "Date Modified", width: 150, text: (item) => formatDate(item.mtime), sortValue: (item) => item.mtime, descendingFirst: true },
    {
      key: "size",
      title: "Size",
      width: 88,
      align: "right",
      text: (item) => (item.kind === "folder" || item.broken ? "—" : formatSize(item.size)),
      sortValue: (item) => (item.kind === "folder" || item.broken ? -1 : item.size),
      descendingFirst: true,
    },
    inLocations
      ? { key: "where", title: "Where", width: 190, text: (item) => item.where ?? "" }
      : { key: "kind", title: "Kind", width: 180, text: (item) => kindText(item) },
  ];
}

/** The least room the Name column keeps; the other columns leave before it gets less. */
export const NAME_FLOOR = 160;
/** The table's own side padding and each cell's (Table's PAD). */
const TABLE_PAD = 10;
/** Which columns leave first when the list is narrow: what kind, or where, then when, then how big. */
const LEAVE_ORDER = ["kind", "where", "modified", "deleted", "size"];

/**
 * The columns that fit a list `width` wide with Name keeping at least
 * `NAME_FLOOR`: Kind (or Where) leaves first, then the date, then Size, so
 * no column is ever drawn in part and the names never go (0: not laid out yet, all of them).
 */
export function fitColumns(columns: readonly FileColumn[], width: number): FileColumn[] {
  if (width <= 0) return [...columns];
  const fixed = (shown: readonly FileColumn[]): number => shown.reduce((sum, column) => sum + (column.width ?? 0), TABLE_PAD);
  let shown = [...columns];
  for (const key of LEAVE_ORDER) {
    if (width - fixed(shown) >= NAME_FLOOR) break;
    shown = shown.filter((column) => column.key !== key);
  }
  return shown;
}

export const DEFAULT_SORT: SortState = { key: "name", ascending: true };

/** `items` sorted by `sort` with folders first. The sort within each group is stable. */
export function sortItems(items: readonly FileItem[], columns: readonly FileColumn[], sort: SortState | null): FileItem[] {
  // No sort chosen (Recents, the Trash): the list's own order, newest first.
  if (sort === null) return [...items];
  // By name first, so rows that tie on the chosen column (all the folders on a size sort) fall in name order.
  const byName = sortRows(items, columns, DEFAULT_SORT);
  const folders = byName.filter((item) => item.kind === "folder");
  const files = byName.filter((item) => item.kind !== "folder");
  return [...sortRows(folders, columns, sort), ...sortRows(files, columns, sort)];
}

/** Items whose name starts with `prefix` (case-insensitive), for type-to-select: the first after `from` that matches, wrapping around. */
export function findByPrefix(items: readonly FileItem[], prefix: string, from: string | null): FileItem | null {
  const lower = prefix.toLowerCase();
  if (!lower) return null;
  const start =
    from === null
      ? 0
      : Math.max(
          0,
          items.findIndex((item) => item.path === from),
        );
  const ordered = [...items.slice(start), ...items.slice(0, start)];
  // A repeated single letter cycles through the matches; a longer prefix stays on the current match if it still fits.
  const current = from === null ? undefined : ordered[0];
  if (lower.length > 1 && current?.name.toLowerCase().startsWith(lower)) return current;
  const skipCurrent = lower.length === 1 && current?.name.toLowerCase().startsWith(lower) ? 1 : 0;
  const found = ordered.slice(skipCurrent).find((item) => item.name.toLowerCase().startsWith(lower));
  return found ?? (skipCurrent > 0 ? (current ?? null) : null);
}
