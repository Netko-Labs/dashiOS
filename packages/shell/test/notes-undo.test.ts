import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
