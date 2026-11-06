/**
 * The ranking's history, as data: what was opened (from the launcher, the
 * Dock, the switcher, a file), and what was picked for which query. Counts
 * decay, so last month's habit gives way to this week's: an opening is worth
 * half as much after two weeks, a pick after a month. Bounded in every
 * direction (ids, queries, picks per query, id and query length), so the file
 * stays small whatever happens. Pure: store.ts reads and writes it.
 */

import { prepare } from "./fold.ts";

/** A decayed count, as of `at` (ms since the epoch). */
export interface Use {
  count: number;
  at: number;
}

export interface Memory {
  /** By id. */
  opened: Map<string, Use>;
  /** By folded query (pickKey), then by id. */
  picked: Map<string, Map<string, Use>>;
}

const DAY = 86_400_000;
export const OPEN_HALF_LIFE = 14 * DAY;
export const PICK_HALF_LIFE = 30 * DAY;
export const MAX_OPENED = 1000;
export const MAX_QUERIES = 300;
export const MAX_PICKS_PER_QUERY = 8;
export const MAX_ID_LENGTH = 512;
export const MAX_QUERY_LENGTH = 32;
/** A pick for a longer query that starts with this one counts this much ("set" helps "se"). */
const PREFIX_WEIGHT = 0.5;
/** Below this a count is forgotten when the memory is pruned. */
const FORGOTTEN = 0.01;

export const emptyMemory = (): Memory => ({ opened: new Map(), picked: new Map() });

/** The key a query's picks are kept under: folded and compacted like the ranking reads it, and bounded. */
export const pickKey = (query: string): string => prepare(query).text.slice(0, MAX_QUERY_LENGTH);

export const isRankId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);

/** `use` as of `now`. */
export function decayed(use: Use | undefined, now: number, halfLife: number): number {
  if (!use) return 0;
  const age = Math.max(0, now - use.at);
  return use.count * 2 ** (-age / halfLife);
}

const bump = (use: Use | undefined, now: number, halfLife: number): Use => ({ count: decayed(use, now, halfLife) + 1, at: now });

/** `id` was opened. */
export function recordOpen(memory: Memory, id: string, now: number): void {
  if (!isRankId(id)) return;
  memory.opened.set(id, bump(memory.opened.get(id), now, OPEN_HALF_LIFE));
  prune(memory, now);
}

/** `id` was picked for `query` (and so opened). */
export function recordPick(memory: Memory, query: string, id: string, now: number): void {
  if (!isRankId(id)) return;
  const key = pickKey(query);
  if (key) {
    const picks = memory.picked.get(key) ?? new Map<string, Use>();
    picks.set(id, bump(picks.get(id), now, PICK_HALF_LIFE));
    // Most recently used queries last, so pruning drops the stalest.
    memory.picked.delete(key);
    memory.picked.set(key, picks);
  }
  recordOpen(memory, id, now);
}

/** Reset Ranking for one item: its openings and every pick of it. */
export function forget(memory: Memory, id: string): void {
  memory.opened.delete(id);
  for (const [query, picks] of memory.picked) {
    picks.delete(id);
    if (picks.size === 0) memory.picked.delete(query);
  }
}

/** How strongly each id was picked for `query`: picks for it in full, for longer queries that start with it at half. */
export function pickWeights(memory: Memory, query: string, now: number): Map<string, number> {
  const key = pickKey(query);
  const weights = new Map<string, number>();
  if (!key) return weights;
  for (const [stored, picks] of memory.picked) {
    const weight = stored === key ? 1 : stored.startsWith(key) ? PREFIX_WEIGHT : 0;
    if (weight === 0) continue;
    for (const [id, use] of picks) weights.set(id, (weights.get(id) ?? 0) + weight * decayed(use, now, PICK_HALF_LIFE));
  }
  return weights;
}

/** Keep the memory inside its bounds, dropping what counts least now. */
export function prune(memory: Memory, now: number): void {
  for (const [id, use] of memory.opened) if (decayed(use, now, OPEN_HALF_LIFE) < FORGOTTEN) memory.opened.delete(id);
  if (memory.opened.size > MAX_OPENED) {
    const kept = [...memory.opened].sort((a, b) => decayed(b[1], now, OPEN_HALF_LIFE) - decayed(a[1], now, OPEN_HALF_LIFE)).slice(0, MAX_OPENED);
    memory.opened = new Map(kept);
  }
  for (const [query, picks] of memory.picked) {
    for (const [id, use] of picks) if (decayed(use, now, PICK_HALF_LIFE) < FORGOTTEN) picks.delete(id);
    if (picks.size > MAX_PICKS_PER_QUERY) {
      const kept = [...picks].sort((a, b) => decayed(b[1], now, PICK_HALF_LIFE) - decayed(a[1], now, PICK_HALF_LIFE)).slice(0, MAX_PICKS_PER_QUERY);
      memory.picked.set(query, new Map(kept));
    }
    if ((memory.picked.get(query)?.size ?? 0) === 0) memory.picked.delete(query);
  }
  while (memory.picked.size > MAX_QUERIES) {
    const stalest = memory.picked.keys().next().value;
    if (stalest === undefined) break;
    memory.picked.delete(stalest);
  }
}

const toPair = (use: Use): [number, number] => [Math.round(use.count * 1000) / 1000, use.at];

/** The memory as the file holds it: `{ version, opened: { id: [count, at] }, picked: { query: { id: [count, at] } } }`. */
export function serializeMemory(memory: Memory): string {
  const opened = Object.fromEntries([...memory.opened].map(([id, use]) => [id, toPair(use)]));
  const picked = Object.fromEntries([...memory.picked].map(([query, picks]) => [query, Object.fromEntries([...picks].map(([id, use]) => [id, toPair(use)]))]));
  return `${JSON.stringify({ version: 1, opened, picked })}\n`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseUse(value: unknown): Use | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [count, at] = value as unknown[];
  if (typeof count !== "number" || typeof at !== "number" || !Number.isFinite(count) || !Number.isFinite(at) || count <= 0 || at < 0) return null;
  return { count: Math.min(count, 1e6), at };
}

/** A saved memory, or an empty one when the text is not ours. Entries that don't parse are dropped one by one; the bounds hold. */
export function parseMemory(text: string, now: number): Memory {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return emptyMemory();
  }
  const memory = emptyMemory();
  if (!isRecord(value) || value.version !== 1) return memory;
  if (isRecord(value.opened)) {
    for (const [id, raw] of Object.entries(value.opened)) {
      const use = parseUse(raw);
      if (use && isRankId(id)) memory.opened.set(id, use);
    }
  }
  if (isRecord(value.picked)) {
    for (const [query, raw] of Object.entries(value.picked)) {
      if (!isRecord(raw) || query !== pickKey(query) || !query) continue;
      const picks = new Map<string, Use>();
      for (const [id, each] of Object.entries(raw)) {
        const use = parseUse(each);
        if (use && isRankId(id)) picks.set(id, use);
      }
      if (picks.size > 0) memory.picked.set(query, picks);
    }
  }
  prune(memory, now);
  return memory;
}
