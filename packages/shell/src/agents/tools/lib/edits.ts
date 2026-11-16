/**
 * Changing and deleting what the person already wrote in Notes and Calendar
 * (docs/actions.md, "Notes and Calendar"). Not destructive under the
 * critical-only rule: a deleted note goes to Notes' Recently Deleted, a
 * deleted event to the Trash as an .ics Calendar imports back, and a change
 * says what was there before.
 */

import { optional } from "@dashi/shape";
import { isNoteId } from "../../../shared/notes/index.ts";
import { fail, type ToolDef } from "../define.ts";
import { custom, tool, wholeArg } from "./args.ts";
import { parseWhen } from "./calendar.ts";

const MAX_TEXT = 100_000;

const noteId = custom(
  { type: "string", description: 'A note id from list_notes, like "Work/Plan.md".' },
  (value) => (isNoteId(value) ? value : null),
  '`id` is required: a note id from list_notes, like "Work/Plan.md".',
);
const words = (max: number, says: string, description: string) =>
  optional(custom<string>({ type: "string", maxLength: max, description }, (value) => (typeof value === "string" && value.length <= max ? value : null), says));
const line = (description: string) => optional(wholeArg(1, 10_000_000, "Line numbers start at 1.", description));
const uid = custom<string>(
  { type: "string", description: "The event's uid from list_events." },
  (value) => (typeof value === "string" && value.length > 0 && value.length <= 1000 ? value : null),
  "`uid` is required: an event's uid from list_events.",
);
const when = (description: string) =>
  optional(
    custom<string>(
      { type: "string", description },
      (value) => {
        const parsed = parseWhen(value);
        return parsed ? (parsed.time === null ? parsed.day : `${parsed.day}T${parsed.time}`) : null;
      },
      "A day like 2026-11-05 or a time like 2026-11-05T14:00.",
    ),
  );

export const editTools: readonly ToolDef[] = [
  tool({
    name: "edit_note",
    title: "Change a note",
    description:
      "Change a note's text: replace `find` (exact text that is there once) with `text`; or replace lines `from_line` to `to_line`; or insert `text` before `at_line`. " +
      "`title` renames it. The result says what was there before. Read the note first.",
    scope: "notes_write",
    readOnly: false,
    destructive: false,
    args: {
      id: noteId,
      text: words(MAX_TEXT, "`text` must be text.", "The new text (empty removes)."),
      find: words(MAX_TEXT, "`find` must be text.", "Text that is in the note once, to replace."),
      from_line: line("The first line to replace (lines of the note's text, from 1)."),
      to_line: line("The last line to replace."),
      at_line: line("Insert before this line (one past the last line adds at the end)."),
      title: words(200, "`title` is at most 200 characters.", "A new title."),
    },
    build: (args) => {
      const text = args.text ?? "";
      const ways = [args.find !== undefined, args.from_line !== undefined || args.to_line !== undefined, args.at_line !== undefined].filter(Boolean).length;
      if (ways === 0 && args.title !== undefined) return { name: "edit_note", id: args.id, edit: null, title: args.title };
      if (ways !== 1) return fail("Give one way to change it: `find`, `from_line` and `to_line`, or `at_line` (or only `title`).");
      if (args.text === undefined) return fail("`text` is required: what goes there (empty removes).");
      const edit =
        args.find !== undefined
          ? { find: args.find, text }
          : args.at_line !== undefined
            ? { at: args.at_line, text }
            : { from: args.from_line ?? args.to_line ?? 1, to: args.to_line ?? args.from_line ?? 1, text };
      return { name: "edit_note", id: args.id, edit, title: args.title ?? null };
    },
  }),
  tool({
    name: "delete_note",
    title: "Delete a note",
    description: "Move a note to Recently Deleted in Notes, where the person can put it back.",
    scope: "notes_write",
    readOnly: false,
    destructive: false,
    args: { id: noteId },
    build: ({ id }) => ({ name: "delete_note", id }),
  }),
  tool({
    name: "edit_event",
    title: "Change an event",
    description:
      "Change an event by its uid: its title, start, end, place, notes, or calendar; what you leave out stays. A new start keeps its length. A repeating event changes every time it repeats. The result says what it was.",
    scope: "calendar_write",
    readOnly: false,
    destructive: false,
    args: {
      uid,
      title: words(200, "`title` is at most 200 characters.", "A new title."),
      start: when("A new start: a day (all day) or a time like 2026-11-05T14:00."),
      end: when("A new end: a time, or for an all-day event its last day."),
      location: words(500, "`location` is at most 500 characters.", "A new place."),
      notes: words(20_000, "`notes` is at most 20,000 characters.", "New notes."),
      calendar: words(100, "`calendar` is a calendar's name or id.", "Move it to this calendar."),
    },
    build: (args) => ({
      name: "edit_event",
      uid: args.uid,
      title: args.title ?? null,
      start: args.start ?? null,
      end: args.end ?? null,
      location: args.location ?? null,
      notes: args.notes ?? null,
      calendar: args.calendar ?? null,
    }),
  }),
  tool({
    name: "delete_event",
    title: "Delete an event",
    description: "Delete an event (all its occurrences) by its uid. A copy goes to the Trash as an .ics file, which Calendar imports back when opened.",
    scope: "calendar_write",
    readOnly: false,
    destructive: false,
    args: { uid },
    build: ({ uid }) => ({ name: "delete_event", uid }),
  }),
];
