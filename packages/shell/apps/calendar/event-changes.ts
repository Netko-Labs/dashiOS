/**
 * Writing a change to an event to the files, and the Undo steps for it. The
 * model (model.ts) says when; this says how: the new place is written
 * first, so a failure never loses the event, and what was written before a
 * failure is still taken back by Undo.
 */

import type { UndoStack } from "@dashi/ui";
import type { CalendarStore } from "../../src/shared/calendar/store.ts";
import type { CalEvent } from "../../src/shared/calendar/types.ts";
import type { EditResult, Scope } from "./edits.ts";
import { type EventChange, eventStep } from "./history.ts";
import type { OccurrenceRef } from "./state.ts";

export interface ChangeRequest {
  ref: OccurrenceRef;
  /** The event as it is on disk now. */
  before: { calendarId: string; event: CalEvent };
  edit: (event: CalEvent) => EditResult;
  scope: Scope;
  options: { moveTo?: string; name?: string };
}

/** Writes the change; each file written is added to `changes` as it is, so a failure part-way still lists what was done. */
export function writeChange(store: CalendarStore, { ref, before, edit, scope, options }: ChangeRequest, changes: EventChange[]): true {
  const result = edit(before.event);
  const whole = ref.recurrenceId === null || scope === "all";
  const home = options.moveTo !== undefined && whole ? options.moveTo : ref.calendarId;
  if (result.event) {
    // The new place first, so a failure never loses the event.
    store.put(home, result.event);
    if (home !== ref.calendarId) store.delete(ref.calendarId, ref.uid);
    changes.push({ before, after: { calendarId: home, event: result.event } });
  } else {
    store.delete(ref.calendarId, ref.uid);
    changes.push({ before, after: null });
  }
  if (result.added) {
    const where = options.moveTo ?? ref.calendarId;
    store.put(where, result.added);
    changes.push({ before: null, after: { calendarId: where, event: result.added } });
  }
  return true;
}

/** Puts the changes on the Undo stack: one step, or a group named for the first. */
export function rememberChanges(undo: UndoStack, store: CalendarStore, reload: () => void, changes: readonly EventChange[], name?: string): void {
  const steps = changes.filter((change) => change.before || change.after);
  const first = steps[0];
  if (!first) return;
  if (steps.length === 1) return undo.push(eventStep(first, store, reload, name));
  undo.group(name ?? eventStep(first, store, reload).name, () => {
    for (const change of steps) undo.push(eventStep(change, store, reload));
  });
}
