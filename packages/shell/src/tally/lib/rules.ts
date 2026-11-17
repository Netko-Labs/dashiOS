/**
 * The cut rules, as one pure step: from what was decided, what is live now
 * and the time, who holds the tally next. No timers here: `nextChange` says
 * when the answer could change by itself, and the store (store.ts) wakes then.
 *
 * Order: something critical asks; then a pin; then something due, earliest
 * deadline first; then something running, newest first. A holder keeps it
 * at least a minute unless something critical asks; an item that lost it
 * cannot retake it for ten minutes while anything else could hold it, unless
 * it became more urgent since (a running timer reaching zero); a due item
 * holds at most two minutes unanswered, then goes to its notification;
 * house lights go down for asking and due, at most two minutes in a row.
 */

import { type OnAirItem, TALLY_RULES } from "../types.ts";

export interface TallyState {
  holder: string | null;
  /** When the holder took it. */
  heldSince: number;
  pinned: string | null;
  /** Items that lost it: when, and how urgent they were then. */
  lost: Readonly<Record<string, { at: number; rank: number }>>;
  /** Due items' first moment on air as due, for the two-minute end. */
  dueOnAir: Readonly<Record<string, number>>;
  /** Due items whose two minutes ran out: they no longer go on air as due. */
  spent: readonly string[];
  /** When the house lights went down; null while they are up. */
  houseSince: number | null;
}

export const EMPTY_TALLY: TallyState = { holder: null, heldSince: 0, pinned: null, lost: {}, dueOnAir: {}, spent: [], houseSince: null };

/** 3 asks (critical), 2 due, 1 running. A pin ranks 2.5: over due, under asking. */
export function rank(item: OnAirItem, state: Pick<TallyState, "pinned" | "spent">): number {
  const base = item.reason === "asks" && item.critical ? 3 : item.reason === "due" && !state.spent.includes(item.key) ? 2 : 1;
  return state.pinned === item.key && base < 3 ? 2.5 : base;
}

/** Whether `a` should hold before `b`. */
function before(a: OnAirItem, b: OnAirItem, state: TallyState): boolean {
  const ra = rank(a, state);
  const rb = rank(b, state);
  if (ra !== rb) return ra > rb;
  if (ra === 2) return (a.deadline ?? a.since) < (b.deadline ?? b.since);
  return a.since > b.since;
}

function locked(item: OnAirItem, state: TallyState, now: number): boolean {
  const lost = state.lost[item.key];
  if (!lost || state.pinned === item.key) return false;
  return now - lost.at < TALLY_RULES.noRetakeMs && rank(item, state) <= lost.rank;
}

/** The best item allowed to hold now, ignoring the hold. */
function best(items: readonly OnAirItem[], state: TallyState, now: number): OnAirItem | null {
  const sorted = [...items].sort((a, b) => (before(a, b, state) ? -1 : before(b, a, state) ? 1 : 0));
  return sorted.find((item) => !locked(item, state, now)) ?? sorted[0] ?? null;
}

/** Due items whose two minutes on air ran out. */
function spentNow(items: readonly OnAirItem[], state: TallyState, now: number): string[] {
  const spent = state.spent.filter((key) => items.some((item) => item.key === key));
  for (const item of items) {
    const first = state.dueOnAir[item.key];
    if (item.reason === "due" && first !== undefined && now - first >= TALLY_RULES.urgentMs && !spent.includes(item.key)) spent.push(item.key);
  }
  return spent;
}

/** One step: the state after `items` are live at `now`. */
export function decide(previous: TallyState, live: readonly OnAirItem[], now: number): TallyState {
  const spent = spentNow(live, previous, now);
  // A spent due item has gone to its notification: it is no longer on air at all.
  const items = live.filter((item) => !spent.includes(item.key));
  const keys = new Set(items.map((item) => item.key));
  const pinned = previous.pinned !== null && keys.has(previous.pinned) ? previous.pinned : null;
  let state: TallyState = { ...previous, pinned, spent };
  const current = items.find((item) => item.key === state.holder) ?? null;
  const outgoing = live.find((item) => item.key === state.holder) ?? null;
  const next = best(items, state, now);
  let holder = next;
  if (current && next && current !== next) {
    const holding = now - state.heldSince < TALLY_RULES.holdMs;
    const critical = rank(next, state) === 3 && rank(current, state) < 3;
    if (holding && !critical) holder = current;
  }
  const holderKey = holder?.key ?? null;
  if (holderKey !== state.holder) {
    const lost = { ...state.lost };
    if (outgoing) lost[outgoing.key] = { at: now, rank: rank(outgoing, state) };
    state = { ...state, holder: holderKey, heldSince: now, lost };
  }
  return settle(state, holder, new Set(live.map((item) => item.key)), now);
}

/** Forget what no longer matters, and set the due clock and the house lights. */
function settle(state: TallyState, holder: OnAirItem | null, keys: ReadonlySet<string>, now: number): TallyState {
  const lost = Object.fromEntries(Object.entries(state.lost).filter(([key, value]) => keys.has(key) && now - value.at < TALLY_RULES.noRetakeMs));
  const dueOnAir = Object.fromEntries(Object.entries(state.dueOnAir).filter(([key]) => keys.has(key)));
  if (holder?.reason === "due" && dueOnAir[holder.key] === undefined) dueOnAir[holder.key] = now;
  const urgent = holder !== null && rank(holder, state) >= 2 && rank(holder, state) !== 2.5;
  const houseSince = urgent ? (state.houseSince ?? now) : null;
  return { ...state, lost, dueOnAir, houseSince };
}

/** Whether the house lights are down at `now`. */
export function houseDown(state: TallyState, now: number): boolean {
  return state.houseSince !== null && now - state.houseSince < TALLY_RULES.urgentMs;
}

/** The next moment the decision could change with nothing new coming in; null for never. */
export function nextChange(state: TallyState, now: number): number | null {
  const times = [
    state.heldSince + TALLY_RULES.holdMs,
    ...Object.values(state.lost).map((value) => value.at + TALLY_RULES.noRetakeMs),
    ...Object.values(state.dueOnAir).map((at) => at + TALLY_RULES.urgentMs),
    state.houseSince === null ? Number.POSITIVE_INFINITY : state.houseSince + TALLY_RULES.urgentMs,
  ].filter((at) => at > now);
  const soonest = Math.min(...times);
  return Number.isFinite(soonest) ? soonest : null;
}
