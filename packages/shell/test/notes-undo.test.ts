import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UndoStack } from "@dashi/ui";
import { notesMenus } from "../apps/notes/menus.ts";
import { NotesModel } from "../apps/notes/model.ts";
import { NotesStore } from "../apps/notes/store.ts";

let root = "";
let store: NotesStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dashi-notes-undo-"));
  store = new NotesStore(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("Undo Delete Note puts the note back and opens it; Redo deletes it again", async () => {
  store.create({ title: "Groceries", body: "- milk" });
  store.create({ title: "Ideas", body: "a boat" });
  const model = new NotesModel(store, 60_000);
  model.select("Groceries.md");
  model.trashSelected();
  expect(existsSync(join(root, "Groceries.md"))).toBe(false);
  expect(model.undo.state.undoName).toBe("Delete Note");

  await model.undoStep("undo");
  expect(existsSync(join(root, "Groceries.md"))).toBe(true);
  expect(model.getSnapshot().selected).toBe("Groceries.md");
  expect(model.getSnapshot().draft?.body).toBe("- milk");

  await model.undoStep("redo");
  expect(existsSync(join(root, "Groceries.md"))).toBe(false);
  expect(model.getSnapshot().deleted.map((note) => note.title)).toContain("Groceries");
});

test("Edit names the step and runs it only when it can", () => {
  const stack = new UndoStack();
  let undone = 0;
  const noop = () => {};
  const context = (undo = stack.state) =>
    notesMenus({
      folders: [],
      source: { kind: "all" },
      mode: "edit",
      hasNote: true,
      hasDeleted: false,
      pinned: false,
      noteFolder: "",
      anyDeleted: false,
      undo,
      actions: {
        newNote: noop,
        newFolder: noop,
        renameFolder: noop,
        deleteFolder: noop,
        deleteNote: noop,
        restore: noop,
        purge: noop,
        emptyTrash: noop,
        pin: noop,
        moveTo: noop,
        addChecklistItem: noop,
        setMode: noop,
        show: noop,
        focusSearch: noop,
        undo: () => void undone++,
        redo: noop,
      },
    });
  context().run("undo");
  expect(undone).toBe(0);
  stack.push({ name: "Delete Note", do: noop, undo: noop });
  const { menus, run } = context();
  expect(menus.find((menu) => menu.id === "edit")?.items[0]).toMatchObject({ label: "Undo Delete Note", shortcut: "❖Z", enabled: true });
  run("undo");
  expect(undone).toBe(1);
});
