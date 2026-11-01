/**
 * The images beside the one that is open: the folder's files in the order a
 * person reads them (img2 before img10), and the neighbours of the open one.
 */

import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type Kind, kindOf } from "./kinds.ts";

/** A folder this large is listed up to here; the rest is not reachable with the arrow keys. */
const MAX_ENTRIES = 20_000;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Natural order: digits compare as numbers, letters without regard to case; ties fall back to the raw text so the order is total. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** The names that are visible files of `kind`, in natural order. */
export function orderSiblings(names: readonly string[], kind: Kind): string[] {
  return names.filter((name) => !name.startsWith(".") && kindOf(name) === kind).sort(naturalCompare);
}

export interface Neighbours {
  /** Position in the folder's list, 0-based; -1 when the open file is not in it. */
  index: number;
  count: number;
  previous: string | null;
  next: string | null;
}

/** Where `current` sits among `ordered`, and the names either side. A file that is not listed (a hidden one, a different type) has no neighbours. */
export function neighbours(ordered: readonly string[], current: string): Neighbours {
  const index = ordered.indexOf(current);
  if (index < 0) return { index: -1, count: ordered.length, previous: null, next: null };
  return { index, count: ordered.length, previous: ordered[index - 1] ?? null, next: ordered[index + 1] ?? null };
}

/** Read the folder of `path` and say who its neighbours are. Failures (a vanished or unreadable folder) mean no neighbours. */
export function siblingsOf(path: string, kind: Kind): Neighbours & { dir: string; files: string[] } {
  const dir = dirname(path);
  let names: string[] = [];
  try {
    names = readdirSync(dir).slice(0, MAX_ENTRIES);
  } catch {
    // No listing: just this file.
  }
  const files = orderSiblings(names, kind);
  return { dir, files, ...neighbours(files, basename(path)) };
}

/** The full path of a sibling name. */
export const siblingPath = (dir: string, name: string): string => join(dir, name);
