/**
 * The Notes app's files as agents see them. Notes are Markdown files under
 * ~/Documents/Notes (`DASHI_NOTES_DIR` moves them), read and written through
 * the same store the app uses, so the app sees an agent's changes as it sees
 * any editor's. What a note says is never put in the menu bar: the status
 * line names only what is being done.
 */

import { DEFAULT_FOLDER_NAME } from "../../../apps/notes/names.ts";
import { defaultRoot, NotesStore } from "../../../apps/notes/store.ts";
import { fold, listOrder, searchNotes, wordCount } from "../../../apps/notes/text.ts";
import { NotesError, type Note } from "../../../apps/notes/types.ts";
import { json, type RunContext, text, toolError, type ToolResult } from "../context.ts";

/** The longest note text one read returns. */
export const READ_CHARS = 50_000;

const folderName = (folder: string): string => (folder === "" ? DEFAULT_FOLDER_NAME : folder);
/** "Notes" and "" are the default folder. */
const folderKey = (name: string): string => (name.toLowerCase() === DEFAULT_FOLDER_NAME.toLowerCase() ? "" : name);

function describe(note: Note) {
  return {
    id: note.id,
    title: note.title,
    folder: folderName(note.folder),
    modified: new Date(note.modified).toISOString(),
    pinned: note.pinned,
    words: wordCount(`${note.title} ${note.body}`),
  };
}

/** The first line of `body` that has one of the query's words, cut to 200 characters. */
export function snippet(body: string, query: string): string {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const line = body.split("\n").find((each) => words.some((word) => fold(each).includes(word))) ?? "";
  const trimmed = line.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
}

/** Runs a store step; the store's own refusals are the agent's to read, anything else is a failure to say plainly. */
function attempt(action: (store: NotesStore) => ToolResult): ToolResult {
  try {
    return action(new NotesStore(defaultRoot()));
  } catch (error) {
    return toolError(error instanceof NotesError ? error.message : "The notes folder could not be read or written.");
  }
}

export function listNotes(folder: string | null, limit: number, ctx: RunContext): ToolResult {
  ctx.status("Reading your notes");
  return attempt((store) => {
    const all = store.scan().notes;
    const here = folder === null ? all : all.filter((note) => note.folder.toLowerCase() === folderKey(folder).toLowerCase());
    const ordered = listOrder(here);
    return json({ notes: ordered.slice(0, limit).map(describe), total: ordered.length });
  });
}

export function searchNotesTool(query: string, limit: number, ctx: RunContext): ToolResult {
  ctx.status("Searching your notes");
  return attempt((store) => {
    const found = searchNotes(store.scan().notes, query);
    return json({ notes: found.slice(0, limit).map((note) => ({ ...describe(note), match: snippet(note.body, query) })), total: found.length });
  });
}

export function readNote(id: string, ctx: RunContext): ToolResult {
  ctx.status("Reading a note");
  return attempt((store) => {
    const note = store.read(id);
    const truncated = note.body.length > READ_CHARS;
    return json({ ...describe(note), body: truncated ? note.body.slice(0, READ_CHARS) : note.body, truncated });
  });
}

export function createNote(call: { title: string; body: string; folder: string }, ctx: RunContext): ToolResult {
  ctx.status("Adding a note");
  return attempt((store) => {
    const note = store.create({ folder: folderKey(call.folder), title: call.title, body: call.body });
    return text(`Created the note ${note.id}.`, { id: note.id, folder: folderName(note.folder) });
  });
}

export function appendToNote(id: string, added: string, ctx: RunContext): ToolResult {
  ctx.status("Adding to a note");
  return attempt((store) => {
    const note = store.append(id, added);
    return text(`Added to ${note.id}; it now has ${wordCount(`${note.title} ${note.body}`)} words.`, { id: note.id });
  });
}
