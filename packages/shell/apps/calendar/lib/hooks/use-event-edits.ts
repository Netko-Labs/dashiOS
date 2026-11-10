/**
 * Saving and deleting from the full event sheet, and answering the question
 * a change to one time of a repeat asks (which times it is for).
 */

import type { Occurrence } from "../../../../src/shared/calendar/types.ts";
import { type Draft, draftOf, inputOf, repeatChanged } from "../draft.ts";
import { asksScope, refOf, zonedTimes } from "../grid/grid-edits.ts";
import type { CalendarModel } from "../model.ts";
import type { SheetState } from "../sheets/sheets.tsx";
import type { OccurrenceRef } from "../state.ts";
import type { Grid } from "./use-grid.ts";
import type { Overlays } from "./use-overlays.ts";

type ScopeQuestion = Extract<SheetState, { kind: "scope" }>;

export interface EventEdits {
  /** Open the full sheet for an occurrence. */
  openSheet: (occurrence: Occurrence) => void;
  /** Show a question in a sheet (the full sheet closes). */
  ask: (question: SheetState) => void;
  saveSheet: (draft: Draft) => void;
  deleteFromSheet: () => void;
  answerScope: (question: ScopeQuestion, scope: "this" | "following" | "all") => void;
}

export function useEventEdits({
  model,
  overlays,
  grid,
  days,
  choose,
  noteDeleted,
}: {
  model: CalendarModel;
  overlays: Overlays;
  grid: Grid;
  days: readonly string[];
  choose: (calendarId: string) => void;
  noteDeleted: (title: string) => void;
}): EventEdits {
  const { editing, setEditing, setSheet, closeOverlay, takeKeys } = overlays;

  const openSheet = (occurrence: Occurrence): void => {
    model.dismissMessages();
    grid.closePopover();
    setEditing({ draft: draftOf(occurrence.event, occurrence.calendarId, zonedTimes(occurrence)), occurrence });
  };

  const ask = (question: SheetState): void => {
    setEditing(null);
    setSheet(question);
  };

  const saveSheet = (draft: Draft): void => {
    const occurrence = editing?.occurrence ?? null;
    // The sheet offers only calendars that show; one hidden meanwhile is shown again rather than swallow the event.
    if (!model.reveal(draft.calendarId)) return closeOverlay();
    const input = inputOf(draft);
    if (occurrence === null) {
      if (model.addEvent(draft.calendarId, input)) choose(draft.calendarId);
      if (!days.includes(draft.startDay)) model.goTo(draft.startDay);
      return closeOverlay();
    }
    const ref = refOf(occurrence);
    const moveTo = draft.calendarId !== occurrence.calendarId ? draft.calendarId : undefined;
    if (asksScope(occurrence) && editing) {
      ask({ kind: "scope", action: "change", ref, title: draft.title, input, moveTo, allowThis: !repeatChanged(editing.draft, draft) });
      return;
    }
    model.changeOccurrence(ref, input, "all", { moveTo });
    closeOverlay();
  };

  const deleteFromSheet = (): void => {
    const occurrence = editing?.occurrence ?? null;
    setEditing(null);
    if (occurrence) grid.deleteOccurrence(occurrence);
    takeKeys();
  };

  const answerScope = (question: ScopeQuestion, scope: "this" | "following" | "all"): void => {
    const ref: OccurrenceRef = question.ref;
    if (question.action === "delete") {
      if (model.deleteOccurrence(ref, scope)) noteDeleted(question.title);
      grid.pick(null);
    } else if (question.input) model.changeOccurrence(ref, question.input, scope, { moveTo: question.moveTo, name: question.name });
    closeOverlay();
  };

  return { openSheet, ask, saveSheet, deleteFromSheet, answerScope };
}
