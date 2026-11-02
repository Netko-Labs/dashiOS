/**
 * Calendar's window: the mini month and the calendars on the left, the title,
 * previous / Today / next, Day / Week / Month and + in the toolbar, and the
 * view itself. Events are made and edited in a sheet (Metal has no child
 * windows). The keyboard is the open field's while one is focused; otherwise
 * the kit's KeySink: N new event, T today, 1 2 3 the views, [ and ] or the up
 * and down arrows previous and next (Metal reports no Ctrl shortcuts, and the
 * menu bar's ❖ shortcuts come through useAppMenus).
 */

import { AppWindow, KeySink, type MenuItem, PopupMenu, Segmented, ToolbarButton, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAppMenus } from "../kit/index.ts";
import type { Day } from "./dates.ts";
import { blankDraft, type Draft, draftOf, inputOf } from "./draft.ts";
import { EventSheet } from "./event-sheet.tsx";
import { viewTitle } from "./format.ts";
import { CHEVRON_LEFT, CHEVRON_RIGHT, PLUS } from "./glyphs.ts";
import type { IcsChooser } from "./import.ts";
import { readIcsFile } from "./import.ts";
import { type View as ViewName, viewDays, weekDays } from "./layout.ts";
import { calendarMenus } from "./menus.ts";
import type { CalendarModel } from "./model.ts";
import { MonthView } from "./month-view.tsx";
import { useRegionPrefs } from "./prefs.ts";
import { CalendarSheet, DeleteCalendarSheet, DeleteEventSheet, ImportPathSheet, type SheetState } from "./sheets.tsx";
import { Sidebar } from "./sidebar.tsx";
import { TimeGrid } from "./time-grid.tsx";
import { type Calendar, CalendarError, type Occurrence } from "./types.ts";

export const CALENDAR_SIZE = { width: 1120, height: 740 } as const;

const VIEW_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

type Menu = { x: number; y: number; items: MenuItem[] };
/** The event sheet's draft, and which event it edits (null for a new one). */
type Editing = {
  draft: Draft;
  target: {
    calendarId: string;
    uid: string;
    repeating: boolean;
    custom: boolean /** The time that was clicked, for deleting just that one. */;
    occurrenceStart: string;
  } | null;
};

function TodayButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  return (
    <View
      testID="today"
      onPress={onPress}
      style={{
        height: 28,
        paddingHorizontal: 12,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.button,
        hoverBackgroundColor: colors.separator,
      }}
    >
      <Text style={{ fontSize: 12, color: colors.text }}>Today</Text>
    </View>
  );
}

export function CalendarWindow({ model, chooser, scroll }: { model: CalendarModel; chooser: IcsChooser; scroll: (testID: string, dy: number) => void }) {
  const colors = useColors();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const { clock: prefs, firstDay } = useRegionPrefs();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [keys, setKeys] = useState(0);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(new Date());
      model.tick();
    }, 30_000);
    return () => clearInterval(tick);
  }, [model]);

  const { view, anchor, today, calendars, hidden } = state;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the model is mutable; these say when its occurrences changed
  const occurrences = useMemo(() => model.occurrences(firstDay), [model, state.calendars, state.hidden, state.view, state.anchor, firstDay]);
  const days = useMemo(() => viewDays(view, anchor, firstDay), [view, anchor, firstDay]);
  const colorOf = (id: string): string => calendars.find((calendar) => calendar.id === id)?.color ?? colors.selection;
  // New events go where the last one did, else to Home, else to the first calendar that shows.
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const visible = calendars.filter((calendar) => !hidden.includes(calendar.id));
  const defaultCalendar =
    (visible.find((calendar) => calendar.id === lastUsed) ?? visible.find((calendar) => calendar.name === "Home") ?? visible[0] ?? calendars[0])?.id ?? "";
  const modal = sheet !== null || editing !== null;

  const takeKeys = (): void => setKeys((n) => n + 1);
  const closeOverlay = (): void => {
    setSheet(null);
    setEditing(null);
    setMenu(null);
    takeKeys();
  };

  // ---- Events ----------------------------------------------------------------------

  const newEvent = (day: Day = anchor, minutes: number | null = 9 * 60): void => {
    if (calendars.length === 0) return;
    model.dismissMessages();
    setMenu(null);
    setEditing({ draft: blankDraft(defaultCalendar, day, minutes), target: null });
  };
  const openEvent = (occurrence: Occurrence): void => {
    const event = occurrence.event;
    model.dismissMessages();
    setEditing({
      draft: draftOf(event, occurrence.calendarId),
      target: {
        calendarId: occurrence.calendarId,
        uid: event.uid,
        repeating: event.repeat !== null || event.rawRule !== null,
        custom: event.rawRule !== null,
        occurrenceStart: occurrence.start,
      },
    });
  };
  const saveEvent = (draft: Draft): void => {
    const target = editing?.target ?? null;
    const saved = model.saveEvent(target?.calendarId ?? draft.calendarId, target?.uid ?? null, inputOf(draft), target !== null ? draft.calendarId : undefined);
    if (!saved) return closeOverlay();
    setLastUsed(draft.calendarId);
    // Show where it went, unless it is on screen already.
    if (!days.includes(draft.startDay)) model.goTo(draft.startDay);
    closeOverlay();
  };
  const askDelete = (): void => {
    const target = editing?.target;
    if (!target) return;
    const event = model.calendar(target.calendarId)?.events.find((each) => each.uid === target.uid);
    if (!event) return closeOverlay();
    setEditing(null);
    setSheet({
      kind: "delete-event",
      calendarId: target.calendarId,
      uid: target.uid,
      title: event.title,
      start: target.occurrenceStart,
      repeating: target.repeating,
    });
  };

  // ---- Calendars -----------------------------------------------------------------------

  const calendarMenu = (calendar: Calendar, x: number, y: number): void =>
    setMenu({
      x,
      y,
      items: [
        { label: "Edit Calendar…", onPress: () => setSheet({ kind: "edit-calendar", id: calendar.id, name: calendar.name, color: calendar.color }) },
        {
          label: "Delete Calendar…",
          onPress: () => setSheet({ kind: "delete-calendar", id: calendar.id, name: calendar.name, events: calendar.events.length }),
        },
      ],
    });

  const importFile = (): void => {
    model.dismissMessages();
    chooser
      .choose()
      .then((path) => {
        if (path !== null) importPath(path);
      })
      .catch(() => setSheet({ kind: "import-path", reason: "There is no file chooser here. Type the path of the .ics file instead." }));
  };
  const importPath = (path: string): void => {
    try {
      const file = readIcsFile(path);
      model.importText(file.text, file.name);
      closeOverlay();
    } catch (error) {
      if (error instanceof CalendarError) {
        // A file that is not a calendar is said so in the sheet, which stays for another try.
        setSheet({ kind: "import-path", reason: error.message });
        model.fail(error.message);
      } else throw error;
    }
  };

  const { menus, run } = calendarMenus({
    view,
    modal,
    actions: {
      newEvent: () => newEvent(),
      newCalendar: () => setSheet({ kind: "new-calendar" }),
      importFile,
      setView: (next) => model.setView(next),
      today: () => model.goToday(),
      step: (direction) => model.step(direction),
    },
  });
  useAppMenus(menus, run);

  // ---- The window ---------------------------------------------------------------------

  // The month view shows every day of the mini month, so only the week and day views tint what they show.
  const shown = useMemo(() => new Set(view === "month" ? [] : days), [days, view]);
  const title = viewTitle(view, anchor, view === "week" ? weekDays(anchor, firstDay) : days, prefs);
  const toolbar = (
    <>
      <ToolbarButton testID="previous" glyph={CHEVRON_LEFT} onPress={() => model.step(-1)} />
      <TodayButton onPress={() => model.goToday()} />
      <ToolbarButton testID="next" glyph={CHEVRON_RIGHT} onPress={() => model.step(1)} />
      <View style={{ width: 6 }} />
      <Segmented testID="view" options={VIEW_OPTIONS} value={view} onChange={(next: ViewName) => model.setView(next)} segmentWidth={58} />
      <View style={{ width: 4 }} />
      <ToolbarButton testID="new-event" glyph={PLUS} disabled={calendars.length === 0} onPress={() => newEvent()} />
    </>
  );

  const message = state.error ?? state.notice ?? (state.problems.length > 0 ? state.problems[0] : null);
  const footer =
    message === null ? undefined : (
      <View
        testID="footer"
        style={{
          minHeight: 26,
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingHorizontal: 16,
          borderTopWidth: 1,
          borderColor: colors.separator,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 11, color: state.error ? colors.critical : colors.textMuted }}>
            {message}
          </Text>
        </View>
        <View testID="footer:dismiss" onPress={() => model.dismissMessages()}>
          <Text style={{ fontSize: 11, color: colors.textMuted }}>{state.error !== null || state.notice !== null ? "Dismiss" : ""}</Text>
        </View>
      </View>
    );

  const editingCalendar = sheet?.kind === "edit-calendar" ? sheet : null;
  const overlay = editing ? (
    <EventSheet
      draft={editing.draft}
      calendars={calendars}
      prefs={prefs}
      editing={editing.target === null ? null : { repeating: editing.target.repeating, custom: editing.target.custom }}
      onSave={saveEvent}
      onDelete={askDelete}
      onCancel={closeOverlay}
    />
  ) : sheet?.kind === "new-calendar" ? (
    <CalendarSheet
      title="New Calendar"
      initialName=""
      initialColor={
        calendars.length === 0 ? "#0a84ff" : (["#0a84ff", "#34c759", "#ff9500", "#af52de", "#ff3b30", "#a2845e", "#ffcc00"][calendars.length % 7] as string)
      }
      confirmLabel="Create"
      onCancel={closeOverlay}
      onSubmit={(name, color) => {
        model.createCalendar(name, color);
        closeOverlay();
      }}
    />
  ) : editingCalendar ? (
    <CalendarSheet
      title="Edit Calendar"
      initialName={editingCalendar.name}
      initialColor={editingCalendar.color}
      confirmLabel="Save"
      onCancel={closeOverlay}
      onSubmit={(name, color) => {
        if (name.trim() !== editingCalendar.name) model.renameCalendar(editingCalendar.id, name);
        if (color !== editingCalendar.color) model.recolorCalendar(editingCalendar.id, color);
        closeOverlay();
      }}
    />
  ) : sheet?.kind === "delete-calendar" ? (
    <DeleteCalendarSheet
      sheet={sheet}
      onCancel={closeOverlay}
      onConfirm={() => {
        model.removeCalendar(sheet.id);
        closeOverlay();
      }}
    />
  ) : sheet?.kind === "delete-event" ? (
    <DeleteEventSheet
      sheet={sheet}
      onCancel={closeOverlay}
      onThis={() => {
        model.skipOccurrence(sheet.calendarId, sheet.uid, sheet.start);
        closeOverlay();
      }}
      onAll={() => {
        model.deleteEvent(sheet.calendarId, sheet.uid);
        closeOverlay();
      }}
    />
  ) : sheet?.kind === "import-path" ? (
    <ImportPathSheet reason={sheet.reason} onCancel={closeOverlay} onSubmit={importPath} />
  ) : menu ? (
    <PopupMenu testID="menu" x={menu.x} y={menu.y} items={menu.items} onClose={closeOverlay} />
  ) : undefined;

  return (
    <AppWindow
      title={title}
      toolbar={toolbar}
      overlay={overlay}
      footer={footer}
      sidebar={
        <Sidebar
          anchor={anchor}
          today={today}
          firstDay={firstDay}
          prefs={prefs}
          shown={shown}
          busy={(from, to) => model.busy(from, to)}
          onPick={(day) => {
            model.goTo(day);
            takeKeys();
          }}
          calendars={calendars}
          hidden={hidden}
          onToggle={(id) => model.toggle(id)}
          onMenu={calendarMenu}
          onNewCalendar={() => setSheet({ kind: "new-calendar" })}
          onImport={importFile}
        />
      }
    >
      {!modal && menu === null && (
        <KeySink
          focusKey={keys}
          onKey={(key) => {
            if (key.kind === "up") return model.step(-1);
            if (key.kind === "down") return model.step(1);
            if (key.kind !== "text") return;
            switch (key.text.toLowerCase()) {
              case "n":
                return newEvent();
              case "t":
                return model.goToday();
              case "1":
              case "d":
                return model.setView("day");
              case "2":
              case "w":
                return model.setView("week");
              case "3":
              case "m":
                return model.setView("month");
              case "[":
                return model.step(-1);
              case "]":
                return model.step(1);
            }
          }}
        />
      )}
      {view === "month" ? (
        <MonthView
          anchor={anchor}
          today={today}
          firstDay={firstDay}
          prefs={prefs}
          occurrences={occurrences}
          colorOf={colorOf}
          onNew={(day) => newEvent(day, 9 * 60)}
          onOpen={openEvent}
          onDay={(day) => model.goTo(day, "day")}
        />
      ) : (
        <TimeGrid
          days={days}
          today={today}
          now={now}
          prefs={prefs}
          occurrences={occurrences}
          colorOf={colorOf}
          onNew={(day, minutes) => newEvent(day, minutes)}
          onOpen={openEvent}
          onDay={(day) => model.goTo(day, "day")}
          scroll={scroll}
        />
      )}
    </AppWindow>
  );
}
