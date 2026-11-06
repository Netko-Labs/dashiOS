# Calendar

**The roast**

- You can't drag anything. No drawing an event, no moving it, no stretching it, even though Metal has had `onPointer` all along (`mirin-metal/src/types.ts:260`). Every one of the 336 half-hour slots in week view is a button that opens a 10-row form (`time-grid.tsx:226-238`).
- Click Thursday's weekly standup and the sheet opens on the day the series started, maybe last January (`draft.ts:60-61`). Change the time and you've moved every standup ever: "changes apply to every time it happens" (`event-sheet.tsx:317`).
- Time zones are handled by not having any. Every event is stored as floating wall-clock time, a TZID is converted on read and written back zoneless, and VTIMEZONE is dropped (`ics.ts:10-14`). Fly to Lisbon and your 9:00 New York call is still at 9:00.
- Import a Google or Outlook calendar and every moved meeting stays at its old time. Overrides (RECURRENCE-ID) are "kept but not shown" (`ics.ts:345`), and a permanent footer with an empty "Dismiss" reads the reason out to you forever (`view.tsx:227`, `view.tsx:250`).
- The calendar colors are, per the code comment, "the Mac's calendar colors" (`store.ts:20-21`), pasted twice (`view.tsx:271`). "Inspired, not imitated" lost this one.
- In fairness: the screen itself is calm. It has a single chrome row, a kombu today circle, and a month that fits (calendar.png). It's the nicest-looking empty calendar you can't drag anything onto.

**Findings**

| # | Severity | Area | What's wrong | Evidence |
|---|---|---|---|---|
| 1 | P1 | Creating / moving | There's no drag to create, move or resize. Events and slots only take `onPress`, and new events are always 1 hour. Metal supports press-move-release through `onPointer`, and `minutesAtY` exists but nothing calls it. | `time-grid.tsx:61`, `time-grid.tsx:230`; `draft.ts:47`; `layout.ts:117`; `mirin-metal/src/types.ts:260` |
| 2 | P1 | Recurrence | Editing a repeating event always edits the whole series, with no "this event only" or "this and following". The sheet shows the series' first start, not the occurrence you clicked. | `draft.ts:60-84`, `view.tsx:119-131`, `event-sheet.tsx:316-318` |
| 3 | P1 | Time zones | Everything is floating local time. TZID/Z times are converted to this computer's zone when read and written back without a zone, and VTIMEZONE is dropped. Travel or a zone change shifts every imported event, and you can't plan in another zone. | `ics.ts:10-14`, `ics.ts:160-200`; `dates.ts:3-7`; no zone field in `event-sheet.tsx` |
| 4 | P1 | ICS import | Overrides with a RECURRENCE-ID aren't shown, so moved or cancelled instances appear at their original time (inferred from RFC 5545 semantics). A repeat Calendar can't model (BYSETPOS, "first Monday") is shown once only. | `ics.ts:16-17`, `ics.ts:345`; `types.ts:33` |
| 5 | P1 | Hidden calendars | With every calendar hidden, new events go to `calendars[0]` anyway, so you save one and it vanishes. Clicking anywhere on a calendar's row hides it, which makes reaching this state easy with the default single "Home" calendar. | `view.tsx:98-100`, `sidebar.tsx:33` |
| 6 | P2 | Messages | An unreadable event leaves a permanent footer: `problems[0]` with a "Dismiss" button whose text is empty, so nothing can be pressed. This is a second bar the person can't close. | `view.tsx:227-252` |
| 7 | P2 | Event sheet | Dates must be typed as ISO `2026-11-05` or stepped one day at a time; there's no picker. In 12-hour regions "3" means 3 AM. The weekday letters are hard-coded English starting on Sunday, ignoring the region's first day. | `event-sheet.tsx:87`, `timetext.ts:7`, `timetext.ts:24`, `event-sheet.tsx:43` |
| 8 | P2 | Creating | A single click on any empty month cell or half hour opens the full sheet straight away, so you can't select a day. Every event, however quick, goes through a 500 px, 10-row form. | `month-view.tsx:58`, `time-grid.tsx:230`, `event-sheet.tsx:172-330` |
| 9 | P2 | Keyboard | You can't select, open or delete an event from the keyboard. Up and down page through periods, and left/right do nothing. The comment says Metal has no Ctrl keys, but `onKeyDown` reports every key with its modifiers. | `view.tsx:5-8`, `view.tsx:351-374`; `mirin-metal/src/types.ts:168-177` |
| 10 | P2 | Menus / undo | Only File and View exist: no Edit (Undo, Delete), no Event menu (Edit, Duplicate, Delete) and no Find. Deleting is final: "This can't be undone." | `menus.ts:79`; `sheets.tsx:95` |
| 11 | P2 | Colors / brand | The palette is the Mac's calendar colors, defined twice. Its red `#ff3b30` competes with ume's job (close and destroy). | `store.ts:20-21`, `view.tsx:271` |
| 12 | P2 | Import / export | Import always makes a new calendar, and importing again gives "Holidays 2". You can't import into an existing calendar, subscribe by URL, export, or drop an .ics onto the window (Metal has `onDrop`). | `store.ts:240-246`, `store.ts:134`; `mirin-metal/src/types.ts:278` |
| 13 | P2 | Search | There's no search for events at all. | no search in `apps/calendar/*`; `menus.ts:32-56` |
| 14 | P2 | Launch | Opening Calendar while it's already running sends today's date as `toISOString()`, which is UTC, and switches to Day view. West of UTC in the evening, that's tomorrow. Whether the Dock starts a second process is inferred. | `main.tsx:22`, `main.tsx:39` |
| 15 | P3 | Today indicator | The now line uses `critical` red, a color that already means urgency. It's drawn only in today's column, so in week view you can't follow it across the days. | `time-grid.tsx:250-255`; `dashi-ui/src/theme/palette.ts:71` |
| 16 | P3 | Dark mode | Days outside the month use `surface.field`. In light it's about 1% off the window color (calendar.png, Dec 1-5 barely reads). In dark it's lighter than the window (`#232326` vs `#1e1e20`), so those days look more prominent than the real month. | `month-view.tsx:69`; `dashi-ui/src/theme/surface.ts:22-23` |
| 17 | P3 | Alerts | One alert per event from a fixed list. All-day alerts are 9 AM only. There's no second reminder and no travel time. | `format.ts:79-95`, `types.ts:37` |
| 18 | P3 | Copy | The View menu says "by Day", "by Week", "by Month". "New Event" opens a sheet but has no ellipsis. Buttons say "Delete This Time" in Title Case. "It is taken out of its calendar file." and "Custom (kept)" are implementation talk. The strip says "all-day" and the sheet says "All-day". | `menus.ts:35`, `menus.ts:46`; `sheets.tsx:95`, `sheets.tsx:109`; `event-sheet.tsx:168`, `event-sheet.tsx:214`; `time-grid.tsx:152` |
| 19 | P3 | Performance | The mini month's dots re-expand every repeat on every render, including the 30 s tick. Hiding a calendar rewrites the sidecar and re-parses every .ics file. Settings are polled with `statSync` every 3 s. | `mini-month.tsx:39`, `view.tsx:84-88`; `model.ts:124-127`, `model.ts:77-82`; `prefs.ts:35-56` |
| 20 | P3 | Sidebar | The "⋯" on each calendar row is always visible (calendar.png). The colors are 7 presets with no custom choice. | `sidebar.tsx:66-72`, `sheets.tsx:50-67` |

**Improvements**

1. **Recommended.** *What:* Use `onPointer` on day columns and events: press and drag on empty time to draw an event (snapping with `minutesAtY`), drag a block to move it across days and hours, drag its bottom edge to resize, and press Esc to cancel. *Why:* This is the first thing anyone tries in a calendar, and the platform already supports it. *Size:* L.
2. **Recommended.** *What:* Open the occurrence that was clicked. On saving changes to a repeat, ask "This event / This and following / All events", writing RECURRENCE-ID overrides or splitting the RRULE with UNTIL. *Why:* Editing a series is the most common calendar edit, and today it rewrites history. *Size:* M.
3. **Recommended.** *What:* Keep zones. Store DTSTART;TZID for timed events (the computer's zone by default), keep VTIMEZONE, show events in the current zone, and add an optional zone field to the sheet. Render RECURRENCE-ID overrides and expand more RRULE parts (BYSETPOS, BYMONTHDAY, multi-BYDAY monthly). *Why:* Imports from every major service rely on both. *Size:* L.
4. **Recommended.** *What:* Clicking the checkbox hides a calendar, clicking the row only selects it. New events go only to visible calendars, and if none is visible, show it again and say so. A single click on empty grid selects the day or slot; a double-click or drag creates. *Why:* It closes the vanishing-event trap and the accidental sheets. *Size:* S.
5. **Recommended.** *What:* Replace `PALETTE` with a Dashi palette built from the ingredients and their neighbors (kombu, moss, broth, shiso-adjacent violet, a clay, a slate, a teal), defined once in `store.ts`. Keep ume-red out of it. *Why:* Brand rule, and one source of truth. *Size:* S.
6. *What:* Add a date picker, a small month popover under the day field, to `@dashi/ui`. Parse dates the way the region writes them. Read a bare "3" in 12-hour regions as the next 3 o'clock during working hours (3 PM). Take weekday letters from `weekdayNames(locale, firstDay)`. *Why:* Typing ISO dates is a developer's UI. *Size:* M.
7. *What:* Keyboard: arrows move a selected day (left/right/up/down by day and week), Tab moves through events, Enter opens one, Delete deletes it, and Esc clears. Add Edit (Undo, Delete) and Event menus, with undo for delete and move. *Why:* Power users live here, and the menus should cover what the app does. *Size:* M.
8. *What:* Import into a chosen calendar (or as a new one), skip duplicates by UID, accept .ics dropped on the window, add File › Export…, and later Subscribe to URL…. *Why:* Re-importing shouldn't make "Holidays 2". *Size:* M.
9. *What:* Make problems a dismissable notice that says how many events couldn't be shown, with a "Show" button. Never keep a permanent footer. *Why:* Vertical space, and that "Dismiss" button with no text. *Size:* S.
10. *What:* Draw the now line in kombu across all week columns, with a stronger dot on today's. Give out-of-month cells a muted wash that's darker in both modes. *Why:* Color jobs and dark mode. *Size:* S.
11. *What:* Use `dayOf(new Date())` in `main.tsx:22`, and when the app is relaunched just focus it without forcing Day view. *Why:* It jumps to the wrong day and the wrong view. *Size:* S.
12. *What:* Memoize `busy` by month and calendars, and toggle visibility in memory with no re-parse. *Why:* Cheap fixes that matter once someone imports 20,000 events. *Size:* S.

**One big idea**

Make the grid the editor. Drag across the hours and a block appears with its title field focused on the grid itself: type "Lunch with Mei", press Enter, done. Drag it to another day, stretch it to two hours, and press ❖Z if you didn't mean it. Clicking an event opens a small popover next to it (time, calendar, repeat, alert) with "More…" for the full sheet. Add natural-language quick add ("Dentist Tue 3pm every 6 months") in the same field. Direct manipulation plus a sheet you rarely need is what separates a calendar people tolerate from one they keep open all day.

**Cross-app notes**

- `@dashi/ui` has no date or time picker. Every app that asks for a date will reinvent `event-sheet.tsx:79-140`.
- `Switch` lives in `src/wifi/switch.tsx` and Calendar imports it from there (`event-sheet.tsx:12`). Move it to `@dashi/ui`. Chevron glyphs come from `src/control-center/glyphs.ts` (`calendar/glyphs.ts:4`), and the file helpers from `../notes/files.ts` (`calendar/store.ts:14`). Shared pieces should live in `@dashi/ui` or the kit, not in a sibling's folder.
- `KeySink` only reports up, down, Esc, Enter and text (`dashi-ui/src/key-sink.tsx:41`), and both Calendar and Notes say "Metal reports no Ctrl shortcuts". Metal's `onKeyDown` reports every key with modifiers. Upgrade `KeySink` and fix the docs.
- Direct manipulation (drag to create/move/resize) should become a shared `@dashi/ui` hook on top of `onPointer`, with snapping and Esc to cancel, so Calendar, Files and future apps behave alike.
- Color jobs: `critical` is used for decoration (the now line). The design guide should list which tokens may only be used for state. App palettes (calendar colors, tags) need a Dashi-made set, since no system set exists today.
- `surface.field` is lighter than `surface.window` in dark mode (`surface.ts:23`). Anything that uses it as a "recessed" wash reads as raised in dark mode.
- `ToolbarButton` has no tooltip (`window.tsx:141-175`). Calendar's "+" and chevrons carry no name.
- Menu copy: commands that open a sheet need "…", and button labels follow sentence case, which Calendar, Notes and the shared `ConfirmSheet` callers all break.
