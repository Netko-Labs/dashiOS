/**
 * The grid as the editor, as state: the drag (gesture.ts), the new event
 * being named in place, the picked day, half hour, and event, and the picked
 * event's popover. The views report presses and drags through `handlers`;
 * what a drop, a click, a name, or a key does is decided here, and changes go
 * to the model (a change to one time of a repeat asks first, through `ask`).
 */

import type { Bounds, WindowKeyInfo } from "@mirinjs/metal";
import { useRef, useState } from "react";
import { type ClockPrefs, usesHour24 } from "../../src/shared/time/clock.ts";
import { type Day, dayPart } from "./dates.ts";
import { isSameTimes } from "./drag.ts";
import { occurrenceKey } from "./event-block.tsx";
import { type Drag, useGesture } from "./gesture.ts";
import { asksScope, dropName, halfHour, movedInput, newEventMinutes, pendingAt, pendingInput, refOf } from "./grid-edits.ts";
import type { GridHandlers, GridState } from "./grid-props.ts";
import type { Pending } from "./inline-title.tsx";
import type { CalendarModel, CalendarState } from "./model.ts";
import type { SheetState } from "./sheets.tsx";
import type { Target } from "./target.ts";
import type { Occurrence } from "./types.ts";
import { keyAction } from "./window-keys.ts";

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
  const [pending, setPending] = useState<Pending | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [popover, setPopover] = useState<Grid["popover"]>(null);
  const [reveal, setReveal] = useState<GridState["reveal"]>(null);
  const lastClick = useRef<{ day: Day; minutes: number | null; at: number } | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const picked = pickedKey === null ? null : (occurrences.find((each) => occurrenceKey(each) === pickedKey) ?? null);

  const pick = (occurrence: Occurrence | null): void => {
    setPickedKey(occurrence ? occurrenceKey(occurrence) : null);
    if (occurrence) setSlot(null);
  };

  /** A new event named in place, in the calendar new events go to (shown again first if every one is hidden). */
  const startPending = (day: Day, minutes: number | null): void => {
    if (destination === null) return;
    if (destination.reveal && !model.reveal(destination.calendarId)) return;
    model.dismissMessages();
    setPopover(null);
    pick(null);
    model.select(day);
    setPending(pendingAt(destination.calendarId, day, minutes));
  };

  const savePending = (): void => {
    const named = pendingRef.current;
    if (!named) return;
    pendingRef.current = null;
    setPending(null);
    const input = pendingInput(named, state.today, !usesHour24(prefs));
    const made = model.addEvent(named.calendarId, input);
    if (made && dayPart(input.start) !== dayPart(named.start)) model.goTo(dayPart(input.start));
    options.takeKeys();
  };

  const dropPending = (): void => {
    pendingRef.current = null;
    setPending(null);
    options.takeKeys();
  };

  /** A drag let go: a new event drawn, or one moved or stretched. */
  const onDrop = (drag: Drag): void => {
    const preview = drag.preview;
    if (!preview) return;
    if (drag.kind === "create") {
      if (destination === null || (destination.reveal && !model.reveal(destination.calendarId))) return;
      model.select(drag.day);
      setPending({ calendarId: destination.calendarId, start: preview.start, end: preview.end, allDay: false, title: "" });
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
      startPending(day, minutes);
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
    startPending(day, minutes);
    // Made where the hours may be scrolled away from: they scroll to it.
    if (minutes !== null) setReveal((last) => ({ minutes, count: (last?.count ?? 0) + 1 }));
  };

  const handlers: GridHandlers = {
    begin(start, geometry) {
      // A press elsewhere on the grid saves the event being named, as it is.
      if (pendingRef.current) savePending();
      setPopover(null);
      gesture.begin(start, geometry);
    },
    track: (info) => gesture.track(info),
    clickDay,
    open(occurrence, bounds) {
      if (gesture.justDragged()) return;
      if (pendingRef.current) savePending();
      model.dismissMessages();
      pick(occurrence);
      model.select(dayPart(occurrence.start));
      setPopover({ occurrence, bounds });
    },
    showDay: (day) => model.goTo(day, "day"),
    pendingTitle: (title) => setPending((now) => (now ? { ...now, title } : now)),
    savePending,
    dropPending,
  };

  const onKey = (key: WindowKeyInfo): void => {
    const action = keyAction(key, state.view);
    if (!action) return;
    switch (action.kind) {
      case "escape":
        if (gesture.cancel()) return;
        if (picked) return pick(null);
        return setSlot(null);
      case "move":
        pick(null);
        return model.moveSelection(action.days, firstDay);
      case "enter":
        return picked ? options.openSheet(picked) : newEvent();
      case "delete":
        return picked ? deleteOccurrence(picked) : undefined;
      case "new":
        return newEvent();
      case "today":
        return model.goToday();
      case "view":
        return model.setView(action.view);
      case "step":
        return model.step(action.direction);
    }
  };

  return {
    state: { drag: gesture.drag, pending, selected: state.selected, selectedSlot: slot, selectedEvent: picked ? pickedKey : null, reveal },
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
