/**
 * Calendar's window: the mini month and the calendars on the left; the
 * title, previous / Today / next, Day / Week / Month, Find and + in the
 * toolbar; and the view, which is the editor (use-grid.ts): draw on empty
 * time to make an event and name it in place, drag one to move it, drag its
 * foot to stretch it, press it for its popover. The full sheet is a click
 * further (Edit…). Keys no field takes come to the grid (window-keys.ts);
 * the ❖ chords come through the menus (menus.ts). An .ics file dropped on the
 * window is imported.
 */

import { AppWindow, Button, type MenuItem, Notice, PopUpButton, PopupMenu, SEARCH, SearchField, Segmented, ToolbarButton, useColors, useUndo } from "@dashi/ui";
import { type Bounds, Text, View } from "@mirinjs/metal";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAppMenus } from "../kit/index.ts";
import { chromeFor, VIEW_POPUP_WIDTH } from "./chrome.ts";
import { dayPart } from "./dates.ts";
import { type Draft, draftOf, inputOf, repeatChanged } from "./draft.ts";
import { EventSheet } from "./event-sheet.tsx";
import { shortViewTitle, viewTitle } from "./format.ts";
import { CHEVRON_LEFT, CHEVRON_RIGHT, PLUS } from "./glyphs.ts";
import { asksScope, refOf, zonedTimes } from "./grid-edits.ts";
import { parseIcs } from "./ics.ts";
import { type IcsChooser, isIcsPath, readIcsFile, writeIcsFile } from "./import.ts";
import { type View as ViewName, viewDays, weekDays } from "./layout.ts";
import { calendarMenus } from "./menus.ts";
import type { CalendarModel, OccurrenceRef } from "./model.ts";
import { MonthView } from "./month-view.tsx";
import { EventPopover } from "./popover.tsx";
import { useRegionPrefs } from "./prefs.ts";
import { searchEvents } from "./search.ts";
import { resultsPlace, SearchResults } from "./search-results.tsx";
import { SheetLayer } from "./sheet-layer.tsx";
import type { SheetState } from "./sheets.tsx";
import { CalendarRail, Sidebar } from "./sidebar.tsx";
import { choosableCalendars, newEventTarget } from "./target.ts";
import { TimeGrid } from "./time-grid.tsx";
import { type Calendar, CalendarError, type Occurrence } from "./types.ts";
import { useGrid } from "./use-grid.ts";

export const CALENDAR_SIZE = { width: 1120, height: 740 } as const;

const VIEW_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

type Menu = { x: number; y: number; items: MenuItem[] };
/** The full sheet: its draft as opened, and the time of the event it edits (null for a new one). */
type Editing = { draft: Draft; occurrence: Occurrence | null };

export function TodayButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  return (
    // A Tab stop between ‹ and › (KB-1); Space or Return goes to today.
    <View
      testID="today"
      focusable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        height: 28,
        paddingHorizontal: 12,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.button,
        hoverBackgroundColor: colors.separator,
        focusRingColor: colors.focusRing,
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
  const [hiddenProblems, setHiddenProblems] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ text: string; step: number | null } | null>(null);
  const [search, setSearch] = useState<{ query: string; active: number } | null>(null);
  const [area, setArea] = useState<Bounds>({ x: 0, y: 0, width: CALENDAR_SIZE.width, height: CALENDAR_SIZE.height });
  // Where Find's field is, for its answers to hang from.
  const [findAt, setFindAt] = useState<Bounds | null>(null);
  // The content sits right of the sidebar, so together they are the window's width (Metal records no bounds for the root).
  const windowWidth = area.x + area.width;
  const chrome = chromeFor(windowWidth);
  const [dropping, setDropping] = useState(false);
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
  // New events go to the calendar chosen in the sidebar (or used last), never to a hidden one (target.ts).
  const [chosen, setChosen] = useState<string | null>(null);
  const destination = newEventTarget(calendars, hidden, chosen);
  const undo = useUndo(model.undo);

  const takeKeys = (): void => setKeys((n) => n + 1);
  const closeOverlay = (): void => {
    setSheet(null);
    setEditing(null);
    setMenu(null);
    takeKeys();
  };

  const openSheet = (occurrence: Occurrence): void => {
    model.dismissMessages();
    grid.closePopover();
    setEditing({ draft: draftOf(occurrence.event, occurrence.calendarId, zonedTimes(occurrence)), occurrence });
  };

  const grid = useGrid({
    model,
    state,
    occurrences,
    prefs,
    firstDay,
    destination,
    now: () => new Date(),
    openSheet,
    ask: (question) => {
      setEditing(null);
      setSheet(question);
    },
    deleted: (title) => setDeleted({ text: `Deleted “${title || "New Event"}”.`, step: model.undo.state.undoStep }),
    takeKeys,
  });
  const modal = sheet !== null || editing !== null;

  // ---- Events ----------------------------------------------------------------------

  const saveSheet = (draft: Draft): void => {
    const occurrence = editing?.occurrence ?? null;
    // The sheet offers only calendars that show; one hidden meanwhile is shown again rather than swallow the event.
    if (!model.reveal(draft.calendarId)) return closeOverlay();
    const input = inputOf(draft);
    if (occurrence === null) {
      if (model.addEvent(draft.calendarId, input)) setChosen(draft.calendarId);
      if (!days.includes(draft.startDay)) model.goTo(draft.startDay);
      return closeOverlay();
    }
    const ref = refOf(occurrence);
    const moveTo = draft.calendarId !== occurrence.calendarId ? draft.calendarId : undefined;
    if (asksScope(occurrence) && editing) {
      setEditing(null);
      setSheet({ kind: "scope", action: "change", ref, title: draft.title, input, moveTo, allowThis: !repeatChanged(editing.draft, draft) });
      return;
    }
    model.changeOccurrence(ref, input, "all", { moveTo });
    closeOverlay();
  };

  const answerScope = (question: Extract<SheetState, { kind: "scope" }>, scope: "this" | "following" | "all"): void => {
    const ref: OccurrenceRef = question.ref;
    if (question.action === "delete") {
      if (model.deleteOccurrence(ref, scope)) setDeleted({ text: `Deleted “${question.title || "New Event"}”.`, step: model.undo.state.undoStep });
      grid.pick(null);
    } else if (question.input) model.changeOccurrence(ref, question.input, scope, { moveTo: question.moveTo, name: question.name });
    closeOverlay();
  };

  // ---- Calendars and files -----------------------------------------------------------

  const calendarMenu = (calendar: Calendar, x: number, y: number): void =>
    setMenu({
      x,
      y,
      items: [
        { label: "Edit Calendar…", onPress: () => setSheet({ kind: "edit-calendar", id: calendar.id, name: calendar.name, color: calendar.color }) },
        { label: "Export…", onPress: () => setSheet({ kind: "export", calendarId: calendar.id }) },
        {
          label: "Delete Calendar…",
          onPress: () => setSheet({ kind: "delete-calendar", id: calendar.id, name: calendar.name, events: calendar.events.length }),
        },
      ],
    });

  const importPath = (path: string): void => {
    try {
      const file = readIcsFile(path);
      const name = parseIcs(file.text).name ?? file.name;
      setSheet({ kind: "import-target", text: file.text, name, fileName: path.split("/").at(-1) ?? path });
    } catch (error) {
      if (!(error instanceof CalendarError)) throw error;
      // A file that is not a calendar is said so; a typed path's sheet stays for another try.
      if (sheet?.kind === "import-path") setSheet({ kind: "import-path", reason: error.message });
      model.fail(error.message);
    }
  };
  const importFile = (): void => {
    model.dismissMessages();
    chooser
      .choose()
      .then((path) => {
        if (path !== null) importPath(path);
      })
      .catch(() => setSheet({ kind: "import-path", reason: "There is no file chooser here. Type the path of the .ics file instead." }));
  };
  const exportCalendar = (calendarId: string, path: string): void => {
    try {
      const written = writeIcsFile(path, model.store.text(calendarId));
      model.say(`Exported “${model.calendar(calendarId)?.name ?? calendarId}” to ${written}.`);
      closeOverlay();
    } catch (error) {
      if (!(error instanceof CalendarError)) throw error;
      model.fail(error.message);
    }
  };

  // ---- Find ------------------------------------------------------------------------------

  const results = useMemo(() => (search ? searchEvents(calendars, hidden, search.query, today) : []), [search?.query, calendars, hidden, today, search]);
  const pickResult = (occurrence: Occurrence | undefined): void => {
    if (!occurrence) return;
    setSearch(null);
    model.goTo(dayPart(occurrence.start));
    grid.pick(occurrence);
    takeKeys();
  };

  // ---- Menus -----------------------------------------------------------------------------

  const { menus, run } = calendarMenus({
    view,
    modal,
    picked: grid.picked !== null,
    undo,
    actions: {
      newEvent: grid.newEvent,
      newCalendar: () => setSheet({ kind: "new-calendar" }),
      importFile,
      exportFile: () => {
        const first = destination?.calendarId ?? calendars[0]?.id;
        if (first) setSheet({ kind: "export", calendarId: first });
      },
      setView: (next) => model.setView(next),
      today: () => model.goToday(),
      step: (direction) => model.step(direction),
      undo: () => void model.undoStep("undo"),
      redo: () => void model.undoStep("redo"),
      deleteEvent: () => grid.picked && grid.deleteOccurrence(grid.picked),
      editEvent: () => grid.picked && openSheet(grid.picked),
      duplicate: () => {
        if (!grid.picked) return;
        const copy = model.duplicate(grid.picked);
        if (copy) model.say(`Duplicated “${copy.title}”.`);
      },
      find: () => setSearch((now) => now ?? { query: "", active: 0 }),
    },
  });
  useAppMenus(menus, run);

  // ---- The window ---------------------------------------------------------------------

  // The month view shows every day of the mini month, so only the week and day views tint what they show.
  const shown = useMemo(() => new Set(view === "month" ? [] : days), [days, view]);
  const days7 = view === "week" ? weekDays(anchor, firstDay) : days;
  const title = viewTitle(view, anchor, days7, prefs);
  // The period shown, or Find's field, in the title's place: opening Find moves no control. The title
  // takes the room the controls leave and ends in an ellipsis; a narrow window shows its short form.
  const center = search ? (
    <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}>
      <View
        onLayout={(bounds) => {
          if (findAt === null || bounds.x !== findAt.x || bounds.y !== findAt.y || bounds.width !== findAt.width) setFindAt(bounds);
        }}
        style={{ flex: 1, minWidth: 0, maxWidth: 260, flexDirection: "row" }}
      >
        <SearchField
          testID="find"
          value={search.query}
          placeholder="Find events"
          autoFocus
          width={260}
          minWidth={96}
          onChangeText={(query) => setSearch({ query, active: 0 })}
          onSubmit={() => pickResult(results[search.active])}
          onKeyPress={(key) => {
            if (key === "Escape") {
              setSearch(null);
              takeKeys();
            } else setSearch({ ...search, active: Math.max(0, Math.min(results.length - 1, search.active + (key === "ArrowDown" ? 1 : -1))) });
          }}
        />
      </View>
    </View>
  ) : (
    <View testID="window-title" style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}>
      <View style={{ flexShrink: 1, minWidth: 0, maxWidth: 320 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>
          {chrome.compact ? shortViewTitle(view, anchor, days7, prefs) : title}
        </Text>
      </View>
    </View>
  );
  const toolbar = (
    <>
      <ToolbarButton testID="previous" glyph={CHEVRON_LEFT} tooltip={`Previous ${view}`} onPress={() => model.step(-1)} />
      <TodayButton onPress={() => model.goToday()} />
      <ToolbarButton testID="next" glyph={CHEVRON_RIGHT} tooltip={`Next ${view}`} onPress={() => model.step(1)} />
      {chrome.compact ? (
        <View style={{ width: VIEW_POPUP_WIDTH, flexShrink: 0 }}>
          <PopUpButton testID="view" options={VIEW_OPTIONS} value={view} onChange={(next: ViewName) => model.setView(next)} width={VIEW_POPUP_WIDTH} />
        </View>
      ) : (
        <Segmented testID="view" options={VIEW_OPTIONS} value={view} onChange={(next: ViewName) => model.setView(next)} segmentWidth={52} />
      )}
      <ToolbarButton
        testID="find-button"
        glyph={SEARCH}
        tooltip={search ? "Close Find" : "Find events"}
        onPress={() => {
          if (search) {
            setSearch(null);
            takeKeys();
          } else setSearch({ query: "", active: 0 });
        }}
      />
      <ToolbarButton testID="new-event" glyph={PLUS} tooltip="New event" disabled={calendars.length === 0} onPress={grid.newEvent} />
    </>
  );

  // A notice floats over the calendar until dismissed: what went wrong, a delete with Undo, an import, or the events that couldn't be shown.
  const problemsKey = state.problems.join("\n");
  const undoable = deleted !== null && deleted.step !== null && undo.undoStep === deleted.step;
  const notice = state.error ? (
    <Notice testID="message" tone="error" text={state.error} onDismiss={() => model.dismissMessages()} />
  ) : undoable && deleted ? (
    <Notice
      testID="message"
      text={deleted.text}
      action={<Button label="Undo" testID="message:undo" onPress={() => void model.undoStep("undo")} />}
      onDismiss={() => setDeleted(null)}
    />
  ) : state.notice ? (
    <Notice testID="message" text={state.notice} onDismiss={() => model.dismissMessages()} />
  ) : state.problems.length > 0 && problemsKey !== hiddenProblems ? (
    <Notice
      testID="message"
      text={state.problems.length === 1 ? "1 event couldn't be shown." : `${state.problems.length} events couldn't be shown.`}
      action={<Button label="Show" testID="message:show" onPress={() => setSheet({ kind: "problems" })} />}
      onDismiss={() => setHiddenProblems(problemsKey)}
    />
  ) : undefined;

  const overlay = editing ? (
    <EventSheet
      draft={editing.draft}
      calendars={choosableCalendars(calendars, hidden, editing.draft.calendarId)}
      prefs={prefs}
      firstDay={firstDay}
      editing={editing.occurrence === null ? null : { repeating: asksScope(editing.occurrence), custom: editing.draft.repeat === "custom" }}
      onSave={saveSheet}
      onDelete={() => {
        const occurrence = editing.occurrence;
        setEditing(null);
        if (occurrence) grid.deleteOccurrence(occurrence);
        takeKeys();
      }}
      onCancel={closeOverlay}
    />
  ) : sheet ? (
    <SheetLayer
      sheet={sheet}
      model={model}
      calendars={calendars}
      problems={state.problems}
      onClose={closeOverlay}
      onScope={answerScope}
      onImportPath={importPath}
      onExport={exportCalendar}
    />
  ) : menu ? (
    <PopupMenu testID="menu" x={menu.x} y={menu.y} items={menu.items} onClose={closeOverlay} />
  ) : search ? (
    <SearchResults
      results={results}
      query={search.query}
      active={search.active}
      prefs={prefs}
      colorOf={colorOf}
      place={resultsPlace(findAt, windowWidth)}
      onPick={pickResult}
    />
  ) : grid.popover ? (
    <EventPopover
      occurrence={grid.popover.occurrence}
      calendar={model.calendar(grid.popover.occurrence.calendarId)}
      anchor={grid.popover.bounds ?? { x: area.x + area.width / 2 - 135, y: area.y + 40, width: 0, height: 0 }}
      area={area}
      prefs={prefs}
      onEdit={() => grid.popover && openSheet(grid.popover.occurrence)}
      onDelete={() => grid.popover && grid.deleteOccurrence(grid.popover.occurrence)}
      onClose={grid.closePopover}
    />
  ) : undefined;

  return (
    <AppWindow
      title={title}
      toolbar={toolbar}
      overlay={overlay}
      notice={notice}
      center={center}
      sidebarWidth={chrome.sidebarWidth}
      sidebar={
        chrome.rail ? (
          <CalendarRail
            calendars={calendars}
            hidden={hidden}
            onToggle={(id) => model.toggle(id)}
            onMenu={calendarMenu}
            onNewCalendar={() => setSheet({ kind: "new-calendar" })}
            onImport={importFile}
          />
        ) : (
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
            target={destination?.reveal === false ? destination.calendarId : null}
            onChoose={(id) => {
              // A hidden calendar picked as the one for new events shows again: they never go into a hidden one.
              if (!model.isVisible(id)) model.toggle(id);
              setChosen(id);
              takeKeys();
            }}
            onMenu={calendarMenu}
            onNewCalendar={() => setSheet({ kind: "new-calendar" })}
            onImport={importFile}
          />
        )
      }
    >
      <View
        testID="calendar-content"
        style={{ flex: 1, flexDirection: "column", minHeight: 0, position: "relative" }}
        onLayout={setArea}
        onDrop={(drop) => {
          if (drop.phase === "enter" || drop.phase === "over") setDropping(drop.paths.some(isIcsPath));
          else setDropping(false);
          const file = drop.phase === "drop" ? drop.paths.find(isIcsPath) : undefined;
          if (file) importPath(file);
        }}
      >
        {!modal && grid.popover === null && search === null && menu === null && (
          <View key={String(keys)} testID="keys" onWindowKeyDown={grid.onKey} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }} />
        )}
        {view === "month" ? (
          <MonthView
            anchor={anchor}
            today={today}
            firstDay={firstDay}
            prefs={prefs}
            occurrences={occurrences}
            colorOf={colorOf}
            state={grid.state}
            handlers={grid.handlers}
          />
        ) : (
          <TimeGrid
            days={days}
            today={today}
            now={now}
            prefs={prefs}
            occurrences={occurrences}
            colorOf={colorOf}
            state={grid.state}
            handlers={grid.handlers}
            scroll={scroll}
          />
        )}
        {dropping && (
          <View
            testID="drop-target"
            style={{ position: "absolute", left: 4, top: 4, right: 4, bottom: 4, borderRadius: 8, borderWidth: 2, borderColor: colors.selection }}
          />
        )}
      </View>
    </AppWindow>
  );
}
