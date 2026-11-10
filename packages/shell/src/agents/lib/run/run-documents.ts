/** The person's files, notes, calendar and clipboard history. */

import * as desktop from "../../desktop/index.ts";
import type { Handlers } from "./run-types.ts";

export const documentHandlers = {
  list_folder: (call, ctx) => desktop.listFolder(call, ctx),
  search_files: (call, ctx) => desktop.searchFiles(call, ctx),
  open_file: (call, ctx) => desktop.openFile(call, ctx),
  trash_file: (call, ctx) => desktop.trashFile(call, ctx),
  list_notes: (call, ctx) => desktop.listNotes(call.folder, call.limit, ctx),
  search_notes: (call, ctx) => desktop.searchNotesTool(call.query, call.limit, ctx),
  read_note: (call, ctx) => desktop.readNote(call.id, ctx),
  create_note: (call, ctx) => desktop.createNote(call, ctx),
  append_to_note: (call, ctx) => desktop.appendToNote(call.id, call.text, ctx),
  list_calendars: (_call, ctx) => desktop.listCalendars(ctx),
  list_events: (call, ctx) => desktop.listEvents(call, ctx),
  create_event: (call, ctx) => desktop.createEvent(call, ctx),
  read_clipboard_history: (call, ctx) => desktop.readClipboardHistory(call.limit, ctx),
} satisfies Handlers<
  | "list_folder"
  | "search_files"
  | "open_file"
  | "trash_file"
  | "list_notes"
  | "search_notes"
  | "read_note"
  | "create_note"
  | "append_to_note"
  | "list_calendars"
  | "list_events"
  | "create_event"
  | "read_clipboard_history"
>;
