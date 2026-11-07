/**
 * A change to one time of a repeating event, as RFC 5545 writes it. Pure.
 *
 * - "this": that occurrence alone changes (a RECURRENCE-ID override), or is
 *   deleted (an EXDATE).
 * - "following": the repeat stops the day before it (UNTIL, or a smaller
 *   COUNT), and a new repeat with its own UID starts there with the change.
 * - "all": the whole repeat changes. A time moved on the occurrence that was
 *   clicked moves every occurrence by as much (the repeat's first start is
 *   not set to the clicked one's, which would rewrite its history), and the
 *   deleted and changed occurrences move along.
 */

import { addDays, addMinutes, dayPart, type Local, minutesBetween } from "./dates.ts";
import { type EventInput, makeEvent, makeOverride } from "./event.ts";
import { newUid } from "./ics.ts";
import { countBefore } from "./recurrence.ts";
import type { CalEvent, Override, Repeat } from "./types.ts";

export type Scope = "this" | "following" | "all";

export interface EditResult {
  /** The event as it becomes; null when it is deleted. */
  event: CalEvent | null;
  /** The new repeat that starts at the occurrence ("following"). */
  added: CalEvent | null;
}

const byId = (a: Override, b: Override): number => (a.recurrenceId < b.recurrenceId ? -1 : a.recurrenceId > b.recurrenceId ? 1 : 0);

/** The occurrences an edit carries along, moved by `delta` minutes: the deleted ones, and the changed ones but `except`. */
function carried(event: CalEvent, delta: number, keep: (id: Local) => boolean, except: Local | null): Pick<CalEvent, "exdates" | "overrides"> {
  return {
    exdates: event.exdates.filter(keep).map((id) => addMinutes(id, delta)),
    overrides: event.overrides
      .filter((override) => keep(override.recurrenceId) && override.recurrenceId !== except)
      .map((override) => ({ ...override, recurrenceId: addMinutes(override.recurrenceId, delta) }))
      .sort(byId),
  };
}

/** The repeat cut to end before `at` (an occurrence's start that is not its first). */
function cutBefore(event: CalEvent, at: Local): Repeat | null {
  const repeat = event.repeat;
  if (!repeat) return null;
  const { count: _count, until: _until, ...rest } = repeat;
  if (repeat.count !== undefined) return { ...rest, count: Math.max(1, countBefore(event, at)) };
  return { ...rest, until: addDays(dayPart(at), -1) };
}

/** The input for the whole repeat when the clicked occurrence (`recurrenceId`) was edited to `input`. */
function seriesInput(event: CalEvent, recurrenceId: Local, input: EventInput): { input: EventInput; delta: number } {
  const delta = minutesBetween(recurrenceId, input.start);
  const start = addMinutes(event.start, delta);
  return { input: { ...input, start, end: addMinutes(start, minutesBetween(input.start, input.end)) }, delta };
}

/** Takes `event` with the occurrence at `recurrenceId` (null: the event itself) changed to `input`, for `scope`. */
export function changeOccurrence(event: CalEvent, recurrenceId: Local | null, input: EventInput, scope: Scope): EditResult {
  if (recurrenceId === null) return { event: makeEvent(input, event), added: null };
  // A rule Calendar can't read can't be cut or moved: its changed occurrences change on their own.
  const how: Scope = event.repeat === null ? "this" : scope === "following" && recurrenceId <= event.start ? "all" : scope;
  if (how === "this") {
    const existing = event.overrides.find((override) => override.recurrenceId === recurrenceId);
    const override = makeOverride({ ...input, repeat: undefined }, recurrenceId, existing ?? event);
    const others = event.overrides.filter((each) => each.recurrenceId !== recurrenceId);
    return { event: { ...event, overrides: [...others, override].sort(byId) }, added: null };
  }
  if (how === "all") {
    const series = seriesInput(event, recurrenceId, input);
    const next = makeEvent(series.input, event);
    const keepsTimes = next.allDay === event.allDay && (next.repeat !== null || next.rawRule !== null);
    return { event: { ...next, ...(keepsTimes ? carried(event, series.delta, () => true, recurrenceId) : { exdates: [], overrides: [] }) }, added: null };
  }
  // This and following: the repeat stops before it, and a new one starts there.
  const cut = cutBefore(event, recurrenceId);
  const before = (id: Local): boolean => id < recurrenceId;
  const kept: CalEvent = { ...event, repeat: cut, ...carried(event, 0, before, null) };
  const rest = event.repeat?.count !== undefined ? event.repeat.count - countBefore(event, recurrenceId) : undefined;
  const repeat = input.repeat !== undefined ? input.repeat : event.repeat && rest !== undefined ? { ...event.repeat, count: Math.max(1, rest) } : event.repeat;
  const made = makeEvent({ ...input, repeat }, event);
  const delta = minutesBetween(recurrenceId, made.start);
  const keepsTimes = made.allDay === event.allDay && made.repeat !== null;
  const added: CalEvent = {
    ...made,
    uid: newUid(),
    ...(keepsTimes ? carried(event, delta, (id) => !before(id), recurrenceId) : { exdates: [], overrides: [] }),
  };
  return { event: kept, added };
}

/** Takes `event` with the occurrence at `recurrenceId` deleted, for `scope`; null for the event itself. */
export function deleteOccurrence(event: CalEvent, recurrenceId: Local | null, scope: Scope): EditResult {
  if (recurrenceId === null || scope === "all") return { event: null, added: null };
  const how: Scope = event.repeat === null ? "this" : scope;
  if (how === "this") {
    const exdates = event.exdates.includes(recurrenceId) ? event.exdates : [...event.exdates, recurrenceId].sort();
    return { event: { ...event, exdates, overrides: event.overrides.filter((each) => each.recurrenceId !== recurrenceId) }, added: null };
  }
  if (recurrenceId <= event.start) return { event: null, added: null };
  const before = (id: Local): boolean => id < recurrenceId;
  return { event: { ...event, repeat: cutBefore(event, recurrenceId), ...carried(event, 0, before, null) }, added: null };
}

/** A copy of the occurrence as an event of its own, on its own (a new UID, no repeat). */
export function duplicateOf(event: CalEvent): CalEvent {
  return { ...event, uid: newUid(), repeat: null, rawRule: null, exdates: [], overrides: [] };
}
