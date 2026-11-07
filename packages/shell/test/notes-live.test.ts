import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UndoStack } from "@dashi/ui";
import { plainError } from "../apps/notes/errors.ts";
import { type MenuContext, notesMenus } from "../apps/notes/menus.ts";
import { NotesModel } from "../apps/notes/model.ts";
import { NotesStore } from "../apps/notes/store.ts";
import { NotesError } from "../apps/notes/types.ts";
import { reservedBy } from "../src/app-menus/reserved.ts";
import { chordFromShortcut } from "../src/app-menus/shortcut.ts";

let root = "";
let store: NotesStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dashi-notes-live-"));
  store = new NotesStore(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A model on one note, "Groceries", open. */
function open(body: string): NotesModel {
  store.create({ title: "Groceries", body });
  const model = new NotesModel(store, 60_000);
  model.select("Groceries.md");
  return model;
}

describe("the live page's model", () => {
  test("a run of typing is one Undo; the caret goes back with the text", async () => {
    const model = open("milk");
    model.setSelection({ start: 4, end: 4 });
    model.edit({ body: "milk," });
    model.setSelection({ start: 5, end: 5 });
    model.edit({ body: "milk, eggs" });
    expect(model.undoState()).toMatchObject({ canUndo: true, undoName: "Typing" });
    await model.undoStep("undo");
    expect(model.getSnapshot().draft?.body).toBe("milk");
    expect(model.getSnapshot().selection).toEqual({ start: 4, end: 4 });
    await model.undoStep("redo");
    expect(model.getSnapshot().draft?.body).toBe("milk, eggs");
    model.dispose();
  });

  test("Format › Bold wraps the selection, keeps it on the words, and is its own named step", async () => {
    const model = open("buy milk");
    model.setSelection({ start: 4, end: 8 });
    model.format("bold");
    expect(model.getSnapshot().draft?.body).toBe("buy **milk**");
    expect(model.getSnapshot().selection).toEqual({ start: 6, end: 10 });
    expect(model.undoState().undoName).toBe("Bold");
    await model.undoStep("undo");
    expect(model.getSnapshot().draft?.body).toBe("buy milk");
    model.dispose();
  });

  test("Enter after an item starts the next one, the caret after its box", () => {
    const model = open("- [ ] milk");
    model.setSelection({ start: 10, end: 10 });
    model.edit({ body: "- [ ] milk\n" });
    expect(model.getSnapshot().draft?.body).toBe("- [ ] milk\n- [ ] ");
    expect(model.getSnapshot().selection).toEqual({ start: 17, end: 17 });
    model.dispose();
  });

  test("a box ticked in the text is saved at once, and the caret stays", () => {
    const model = open("- [ ] milk\n- [ ] eggs");
    model.setSelection({ start: 3, end: 3 });
    model.toggleCheck(1);
    expect(readFileSync(join(root, "Groceries.md"), "utf8")).toBe("# Groceries\n\n- [ ] milk\n- [x] eggs\n");
    expect(model.getSnapshot().selection).toEqual({ start: 3, end: 3 });
    expect(model.undoState().undoName).toBe("Checkbox");
  });

  test("Find Next selects the search's words in the note, and says when there are none", () => {
    const model = open("milk, then more milk");
    model.setQuery("milk");
    model.setSelection({ start: 0, end: 0 });
    expect(model.findNext(1)).toBe(true);
    expect(model.getSnapshot().selection).toEqual({ start: 0, end: 4 });
    expect(model.findNext(1)).toBe(true);
    expect(model.getSnapshot().selection).toEqual({ start: 16, end: 20 });
    model.setQuery("bread");
    expect(model.findNext(1)).toBe(false);
    model.dispose();
  });

  test("typing is the note's own: another note opened starts Undo over, and a deleted note is still undone after", async () => {
    store.create({ title: "Ideas", body: "a boat" });
    const model = open("milk");
    model.edit({ body: "milk!" });
    model.trashSelected();
    model.select("Ideas.md");
    expect(model.undoState().undoName).toBe("Delete Note");
    await model.undoStep("undo");
    expect(model.getSnapshot().draft?.body).toBe("milk!");
    model.dispose();
  });
});

describe("file names", () => {
  test("a retitled note keeps its file while it is open, and takes the title's name once it is left", () => {
    store.create({ title: "Ideas", body: "a boat" });
    const model = open("milk");
    model.edit({ title: "Shopping" });
    model.flush();
    expect(model.getSnapshot().selected).toBe("Groceries.md");
    expect(readFileSync(join(root, "Groceries.md"), "utf8")).toBe("# Shopping\n\nmilk\n");
    model.select("Ideas.md");
    expect(
      store
        .scan()
        .notes.map((note) => note.id)
        .sort(),
    ).toEqual(["Ideas.md", "Shopping.md"]);
    model.dispose();
  });
});

describe("errors in plain sentences", () => {
  test("a system error's code never shows", () => {
    const denied = Object.assign(new Error("EACCES: permission denied, open '/x'"), { code: "EACCES" });
    expect(plainError(denied, "save")).toBe("Notes couldn't save this note. It isn't allowed to write in the Notes folder in Documents.");
    expect(plainError(Object.assign(new Error("x"), { code: "ENOSPC" }), "create")).toBe("Notes couldn't make a new note. The disk is full.");
    expect(plainError(new NotesError(`"x" is not a note id.`), "change")).toBe("Notes couldn't do that. That note isn't there any more.");
    expect(plainError(new Error("weird"), "read")).toBe("Notes couldn't read your notes folder.");
  });
});

describe("menus", () => {
  const ran: string[] = [];
  const context = (change: Partial<MenuContext> = {}): MenuContext => {
    const log =
      (name: string) =>
      (...args: unknown[]) =>
        void ran.push([name, ...args].join(":"));
    return {
      folders: ["Work"],
      source: { kind: "all" },
      hasNote: true,
      hasDeleted: false,
      pinned: false,
      noteFolder: "",
      anyDeleted: false,
      hasSelection: false,
      hasMatches: false,
      undo: new UndoStack().state,
      actions: {
        newNote: log("newNote"),
        newFolder: log("newFolder"),
        renameFolder: log("renameFolder"),
        deleteFolder: log("deleteFolder"),
        deleteNote: log("deleteNote"),
        restore: log("restore"),
        purge: log("purge"),
        emptyTrash: log("emptyTrash"),
        pin: log("pin"),
        moveTo: log("moveTo"),
        format: log("format"),
        show: log("show"),
        undo: log("undo"),
        redo: log("redo"),
        cut: log("cut"),
        copy: log("copy"),
        paste: log("paste"),
        selectAll: log("selectAll"),
        find: log("find"),
        findNext: log("findNext"),
      },
      ...change,
    };
  };

  test("File, Edit, Format, Note and View; every shortcut is one the keymap leaves to the app", () => {
    const { menus } = notesMenus(context());
    expect(menus.map((menu) => menu.id)).toEqual(["file", "edit", "format", "note", "view"]);
    const shortcuts = menus.flatMap((menu) => menu.items.flatMap((row) => ("shortcut" in row && row.shortcut ? [row.shortcut] : [])));
    expect(shortcuts).toContain("❖B");
    expect(shortcuts).toContain("❖I");
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    for (const shortcut of shortcuts) {
      const chord = chordFromShortcut(shortcut);
      expect(chord).not.toBeNull();
      if (chord) expect(reservedBy(chord)).toBeNull();
    }
  });

  test("Edit: Undo names the step; Cut and Copy only with a selection; only enabled rows run", () => {
    ran.length = 0;
    const stack = new UndoStack();
    stack.push({ name: "Typing", do: () => {}, undo: () => {} });
    const { menus, run } = notesMenus(context({ undo: stack.state }));
    const edit = menus.find((menu) => menu.id === "edit")?.items ?? [];
    expect(edit[0]).toMatchObject({ label: "Undo Typing", shortcut: "❖Z", enabled: true });
    expect(edit.find((row) => "id" in row && row.id === "copy")).toMatchObject({ enabled: false });
    run("copy");
    run("find:next");
    run("undo");
    run("format:bold");
    run("move:1");
    expect(ran).toEqual(["undo", "format:bold", "moveTo:Work"]);
    notesMenus(context({ hasSelection: true, hasMatches: true })).run("copy");
    notesMenus(context({ hasSelection: true, hasMatches: true })).run("find:previous");
    expect(ran.slice(-2)).toEqual(["copy", "findNext:-1"]);
  });

  test("Format is off in Recently Deleted", () => {
    ran.length = 0;
    const { menus, run } = notesMenus(context({ hasNote: false, hasDeleted: true, source: { kind: "trash" } }));
    expect(menus.find((menu) => menu.id === "format")?.items.every((row) => !("enabled" in row) || row.enabled === false)).toBe(true);
    run("format:italic");
    expect(ran).toEqual([]);
  });
});
