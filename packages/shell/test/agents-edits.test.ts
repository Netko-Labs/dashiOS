import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunContext } from "../src/agents/context.ts";
import { createEvent } from "../src/agents/desktop/calendar.ts";
import { deleteEvent, editEvent } from "../src/agents/desktop/calendar-edit.ts";
import { editBody } from "../src/agents/desktop/lib/note-edit.ts";
import { createNote, deleteNote, editNote, readNote } from "../src/agents/desktop/notes.ts";
import { parseCall } from "../src/agents/index.ts";
import type { Exec } from "../src/shared/files/index.ts";

const ctx = { status: () => {} } as unknown as RunContext;
let dir = "";
const saved = { notes: process.env.DASHI_NOTES_DIR, calendars: process.env.DASHI_CALENDAR_DIR };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-edits-"));
  process.env.DASHI_NOTES_DIR = join(dir, "Notes");
  process.env.DASHI_CALENDAR_DIR = join(dir, "calendars");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of [
    ["DASHI_NOTES_DIR", saved.notes],
    ["DASHI_CALENDAR_DIR", saved.calendars],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("a note's text, changed", () => {
  const body = "Milk\nEggs\nBread\nEggs again";

  test("a find that is there once, a range of lines, an insert; each says what was there", () => {
    expect(editBody(body, { find: "Bread", text: "Rye bread" })).toEqual({ body: "Milk\nEggs\nRye bread\nEggs again", was: "Bread", where: "at line 3" });
    expect(editBody(body, { from: 1, to: 2, text: "Oat milk" })).toEqual({ body: "Oat milk\nBread\nEggs again", was: "Milk\nEggs", where: "lines 1 to 2" });
    expect(editBody(body, { at: 5, text: "Butter" })).toMatchObject({ body: `${body}\nButter`, was: "" });
  });

  test("a text that is there twice, or not at all, or lines out of range are refused in words", () => {
    expect(editBody(body, { find: "Eggs", text: "x" })).toEqual({ error: expect.stringContaining("2 times") });
    expect(editBody(body, { find: "Jam", text: "x" })).toEqual({ error: expect.stringContaining("not in the note") });
    expect(editBody(body, { from: 3, to: 9, text: "" })).toEqual({ error: expect.stringContaining("4 lines") });
  });

  test("through the Notes store: edited, then to Recently Deleted", () => {
    const made = createNote({ title: "Groceries", body, folder: "Notes" }, ctx).structuredContent as { id: string };
    const changed = editNote({ id: made.id, edit: { find: "Bread", text: "Rye bread" }, title: null }, ctx);
    expect(changed.structuredContent).toMatchObject({ was: "Bread" });
    expect(JSON.stringify(readNote(made.id, ctx).structuredContent)).toContain("Rye bread");
    expect(deleteNote(made.id, ctx).isError).toBeUndefined();
    expect(readNote(made.id, ctx).isError).toBe(true);
    expect(existsSync(join(dir, "Notes", ".Recently Deleted")) || readFileSync(join(dir, "Notes", ".dashi-notes.json"), "utf8").includes("trash")).toBe(true);
  });
});

describe("an event, changed and deleted", () => {
  test("a new start keeps its length; the result says what it was; a deleted one goes to the Trash as an .ics", async () => {
    const made = createEvent(
      { title: "Dentist", start: "2026-11-20T09:00", end: "2026-11-20T09:30", calendar: null, location: "", notes: "", repeat: null, alert: null },
      ctx,
    ).structuredContent as { uid: string };
    const moved = editEvent({ uid: made.uid, title: null, start: "2026-11-21T15:00", end: null, location: "Calle 93", notes: null, calendar: null }, ctx);
    expect(moved.structuredContent).toMatchObject({ was: { start: "2026-11-20T09:00", end: "2026-11-20T09:30", location: "" } });
    const trashed: string[] = [];
    const run: Exec = async (command) => {
      const path = command.at(-1) ?? "";
      trashed.push(readFileSync(path, "utf8"));
      rmSync(path);
      return { ok: true, code: 0, stdout: "", stderr: "" };
    };
    const gone = await deleteEvent(made.uid, ctx, run);
    expect(gone.structuredContent).toMatchObject({
      deleted: made.uid,
      was: { title: "Dentist", start: "2026-11-21T15:00", end: "2026-11-21T15:30", location: "Calle 93" },
    });
    expect(trashed[0]).toContain("SUMMARY:Dentist");
    expect((await deleteEvent(made.uid, ctx, run)).isError).toBe(true);
  });

  test("the tools' arguments", () => {
    expect(parseCall({ name: "edit_note", arguments: { id: "A.md", title: "B" } })).toEqual({ name: "edit_note", id: "A.md", edit: null, title: "B" });
    expect(parseCall({ name: "edit_note", arguments: { id: "A.md", find: "x" } })).toEqual({ arguments: expect.stringContaining("`text` is required") });
    expect(parseCall({ name: "edit_note", arguments: { id: "A.md", find: "x", at_line: 2, text: "y" } })).toEqual({
      arguments: expect.stringContaining("one way"),
    });
    expect(parseCall({ name: "edit_event", arguments: { uid: "u", start: "2026-13-01" } })).toEqual({ arguments: expect.any(String) });
  });
});
