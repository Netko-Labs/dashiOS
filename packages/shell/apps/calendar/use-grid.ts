/**
 * The grid as the editor, as state: the drag (gesture.ts), the new event
 * being named in place, the picked day, half hour, and event, and the picked
 * event's popover. The views report presses and drags through `handlers`;
 * what a drop, a click, a name, or a key does is decided here, and changes go
 * to the model (a change to one time of a repeat asks first, through `ask`).
 */

import type { Bounds, WindowKeyInfo } from "@mirinjs/metal";
import { useRef, useState } from "react";
import { type Day, dayPart } from "../../src/shared/calendar/dates.ts";
import type { Occurrence } from "../../src/shared/calendar/types.ts";
import type { ClockPrefs } from "../../src/shared/time/clock.ts";
import { isSameTimes } from "./drag.ts";
import { type Drag, useGesture } from "./gesture.ts";
import { asksScope, dropName, halfHour, movedInput, newEventMinutes, refOf } from "./grid-edits.ts";
import type { GridHandlers, GridState } from "./grid-props.ts";
import { runKey } from "./key-actions.ts";
import type { CalendarModel, CalendarState } from "./model.ts";
import type { SheetState } from "./sheets.tsx";
import type { Target } from "./target.ts";
import { usePending } from "./use-pending.ts";
import { usePicked } from "./use-picked.ts";

/** How soon a second click on the same day or half hour makes an event there. */
export const DOUBLE_CLICK_MS = 450;

export interface GridOptions {
  model: CalendarModel;
  state: CalendarState;
  occurrences: readonly Occurrence[];
  prefs: ClockPrefs;
  firstDay: number;
  /** Where a new event goes (target.ts); null with no calendars. */
  destination: Target | null;
  now: () => Date;
  /** The full sheet for an occurrence. */
  openSheet: (occurrence: Occurrence) => void;
  /** A question in a sheet (a change to one time of a repeat). */
  ask: (sheet: SheetState) => void;
  /** An event was deleted: say so, with Undo. */
  deleted: (title: string) => void;
  /** The keyboard goes back to the window (a field or sheet had it). */
  takeKeys: () => void;
}

export interface Grid {
  state: GridState;
  handlers: GridHandlers;
  popover: { occurrence: Occurrence; bounds: Bounds | undefined } | null;
  closePopover: () => void;
  /** The picked event, while the view shows it. */
  picked: Occurrence | null;
  pick: (occurrence: Occurrence | null) => void;
  newEvent: () => void;
  deleteOccurrence: (occurrence: Occurrence) => void;
  /** Keys the window got that nothing else took. */
  onKey: (key: WindowKeyInfo) => void;
}

export function useGrid(options: GridOptions): Grid {
  const { model, state, occurrences, prefs, firstDay, destination } = options;
  const [popover, setPopover] = useState<Grid["popover"]>(null);
  const [reveal, setReveal] = useState<GridState["reveal"]>(null);
  const lastClick = useRef<{ day: Day; minutes: number | null; at: number } | null>(null);
  const { picked, pickedKey, pick, slot, setSlot } = usePicked(occurrences);
  const named = usePending({
    model,
    today: state.today,
    prefs,
    destination,
    clearSelection: () => {
      setPopover(null);
      pick(null);
    },
    takeKeys: options.takeKeys,
  });

  /** A drag let go: a new event drawn, or one moved or stretched. */
  const onDrop = (drag: Drag): void => {
    const preview = drag.preview;
    if (!preview) return;
    if (drag.kind === "create") {
      if (destination === null || (destination.reveal && !model.reveal(destination.calendarId))) return;
      model.select(drag.day);
      named.set({ calendarId: destination.calendarId, start: preview.start, end: preview.end, allDay: false, title: "" });
      return;
    }
    const occurrence = drag.occurrence;
    if (!occurrence || isSameTimes(occurrence, preview)) return;
    const input = movedInput(occurrence, preview);
    const name = dropName(occurrence, preview);
    pick(occurrence);
    model.select(dayPart(preview.start));
    if (asksScope(occurrence)) {
      options.ask({ kind: "scope", action: "change", ref: refOf(occurrence), title: occurrence.event.title, input, name, allowThis: true });
    } else model.changeOccurrence(refOf(occurrence), input, "all", { name });
  };

  /** A click on an empty day or half hour picks it; a second click on it soon after makes an event there. */
  const clickDay = (day: Day, minutes: number | null): void => {
    setPopover(null);
    pick(null);
    model.select(day);
    setSlot(minutes);
    const now = Date.now();
    const last = lastClick.current;
    if (last && last.day === day && last.minutes === minutes && now - last.at < DOUBLE_CLICK_MS) {
      lastClick.current = null;
      named.start(day, minutes);
    } else lastClick.current = { day, minutes, at: now };
    options.takeKeys();
  };

  const gesture = useGesture({
    onDrop,
    onClick: (start) => {
      if (start.kind === "create") clickDay(start.day, halfHour(start.minutes ?? 0));
    },
  });

  const deleteOccurrence = (occurrence: Occurrence): void => {
    setPopover(null);
    if (asksScope(occurrence)) {
      options.ask({ kind: "scope", action: "delete", ref: refOf(occurrence), title: occurrence.event.title, allowThis: true });
      return;
    }
    if (model.deleteOccurrence(refOf(occurrence), "all")) options.deleted(occurrence.event.title);
    pick(null);
  };

  const newEvent = (): void => {
    const day = state.selected;
    const minutes = state.view === "month" ? null : newEventMinutes(day, slot, state.today, options.now());
    named.start(day, minutes);
    // Made where the hours may be scrolled away from: they scroll to it.
    if (minutes !== null) setReveal((last) => ({ minutes, count: (last?.count ?? 0) + 1 }));
  };

  const handlers: GridHandlers = {
    begin(start, geometry) {
      // A press elsewhere on the grid saves the event being named, as it is.
      if (named.isNaming()) named.save();
      setPopover(null);
      gesture.begin(start, geometry);
    },
    track: (info) => gesture.track(info),
    clickDay,
    open(occurrence, bounds) {
      if (gesture.justDragged()) return;
      if (named.isNaming()) named.save();
      model.dismissMessages();
      pick(occurrence);
      model.select(dayPart(occurrence.start));
      setPopover({ occurrence, bounds });
    },
    showDay: (day) => model.goTo(day, "day"),
    pendingTitle: (title) => named.set((now) => (now ? { ...now, title } : now)),
    savePending: named.save,
    dropPending: named.drop,
  };

  const onKey = (key: WindowKeyInfo): void =>
    runKey(key, {
      model,
      view: state.view,
      firstDay,
      picked,
      pick,
      clearSlot: () => setSlot(null),
      cancelDrag: gesture.cancel,
      openSheet: options.openSheet,
      newEvent,
      deleteOccurrence,
    });

  return {
    state: { drag: gesture.drag, pending: named.pending, selected: state.selected, selectedSlot: slot, selectedEvent: picked ? pickedKey : null, reveal },
    handlers,
    popover: popover && picked ? { occurrence: picked, bounds: popover.bounds } : null,
    closePopover: () => {
      setPopover(null);
      options.takeKeys();
    },
    picked,
    pick,
    newEvent,
    deleteOccurrence,
    onKey,
  };
}
