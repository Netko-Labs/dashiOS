import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conflictNotice, conflictTitle, saveOutcome } from "../apps/notes/conflict.ts";
import { NotesModel } from "../apps/notes/model.ts";
import { NotesStore } from "../apps/notes/store.ts";

describe("which version a save keeps", () => {
  test("only one side changed: that side", () => {
    expect(saveOutcome({ base: "a", disk: "a", mine: "a" })).toBe("nothing");
    expect(saveOutcome({ base: "a", disk: "a", mine: "b" })).toBe("ours");
    expect(saveOutcome({ base: "a", disk: "b", mine: "a" })).toBe("theirs");
  });

  test("both made the same change: nothing to write", () => {
    expect(saveOutcome({ base: "a", disk: "b", mine: "b" })).toBe("same");
  });

  test("both changed, differently: a conflict, whichever looks newer", () => {
    expect(saveOutcome({ base: "a", disk: "b", mine: "c" })).toBe("conflict");
  });

  test("a file that can't be read is saved over only when something was typed", () => {
    expect(saveOutcome({ base: "a", disk: null, mine: "a" })).toBe("nothing");
    expect(saveOutcome({ base: "a", disk: null, mine: "b" })).toBe("ours");
  });

  test("the copy's title and the line that tells the person", () => {
    expect(conflictTitle("Groceries")).toBe("Groceries (conflict)");
    expect(conflictTitle("  ")).toBe("Untitled (conflict)");
    expect(conflictNotice("Groceries", "Groceries (conflict)")).toBe(
      "“Groceries” changed on disk while you were typing. Your version is saved as “Groceries (conflict)”.",
    );
  });
});

describe("the model never writes over a change on disk", () => {
  let root = "";
  let store: NotesStore;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashi-notes-conflict-"));
    store = new NotesStore(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** A model with one note open, "Groceries", saving only when told to. */
  const open = (): NotesModel => {
    store.create({ title: "Groceries", body: "- milk" });
    const model = new NotesModel(store, 60_000);
    expect(model.getSnapshot().selected).toBe("Groceries.md");
    return model;
  };
  /** Another program (a sync tool, an agent) writes the note's file. */
  const sync = (text: string): void => writeFileSync(join(root, "Groceries.md"), text);
  const file = (name: string): string => readFileSync(join(root, name), "utf8");

  test("a change on disk while typing is pending: both are kept, and the person is told", () => {
    const model = open();
    model.edit({ body: "- milk\n- eggs" });
    sync("# Groceries\n\n- milk\n- bread\n");
    model.reload();

    // The file's version stays the note.
    expect(file("Groceries.md")).toBe("# Groceries\n\n- milk\n- bread\n");
    // What was typed is beside it, and the editor goes on with it.
    expect(file("Groceries (conflict).md")).toBe("# Groceries (conflict)\n\n- milk\n- eggs\n");
    const state = model.getSnapshot();
    expect(state.selected).toBe("Groceries (conflict).md");
    expect(state.draft).toEqual({ title: "Groceries (conflict)", body: "- milk\n- eggs" });
    expect(state.notice).toBe(conflictNotice("Groceries", "Groceries (conflict)"));
    expect(state.error).toBeNull();
    // Typing on goes into the copy, never the original.
    model.edit({ body: "- milk\n- eggs\n- tea" });
    model.flush();
    expect(file("Groceries.md")).toBe("# Groceries\n\n- milk\n- bread\n");
    expect(file("Groceries (conflict).md")).toContain("- tea");
    model.dispose();
  });

  test("the save itself looks first, even before the watcher has spoken", () => {
    const model = open();
    model.edit({ body: "- milk\n- eggs" });
    sync("# Groceries\n\n- oat milk\n");
    model.flush();
    expect(file("Groceries.md")).toBe("# Groceries\n\n- oat milk\n");
    expect(
      readdirSync(root)
        .filter((name) => name.endsWith(".md"))
        .sort(),
    ).toEqual(["Groceries (conflict).md", "Groceries.md"]);
    model.dispose();
  });

  test("leaving the note while it conflicts keeps the notice", () => {
    const model = open();
    store.create({ title: "Errands", body: "post office" });
    model.reload();
    model.edit({ body: "- milk\n- eggs" });
    sync("# Groceries\n\n- bread\n");
    model.select("Errands.md");
    expect(model.getSnapshot().notice).toBe(conflictNotice("Groceries", "Groceries (conflict)"));
    // Opening yet another note lets it go.
    model.select("Groceries.md");
    expect(model.getSnapshot().notice).toBeNull();
    model.dispose();
  });

  test("a change on disk with nothing typed is simply taken", () => {
    const model = open();
    sync("# Groceries\n\n- bread\n");
    model.reload();
    expect(model.getSnapshot().draft).toEqual({ title: "Groceries", body: "- bread" });
    expect(readdirSync(root).filter((name) => name.endsWith(".md"))).toEqual(["Groceries.md"]);
    expect(model.getSnapshot().notice).toBeNull();
    model.dispose();
  });

  test("the same change on both sides makes no copy", () => {
    const model = open();
    model.edit({ body: "- milk\n- eggs" });
    sync("# Groceries\n\n- milk\n- eggs\n");
    model.reload();
    expect(readdirSync(root).filter((name) => name.endsWith(".md"))).toEqual(["Groceries.md"]);
    expect(model.getSnapshot().notice).toBeNull();
    model.dispose();
  });

  test("typing alone is saved as before, and its own write is not taken for someone else's", () => {
    const model = open();
    model.edit({ body: "- milk\n- eggs" });
    model.flush();
    expect(file("Groceries.md")).toBe("# Groceries\n\n- milk\n- eggs\n");
    // The watcher fires on that write: nothing changes.
    model.reload();
    model.edit({ body: "- milk\n- eggs\n- tea" });
    model.flush();
    expect(file("Groceries.md")).toBe("# Groceries\n\n- milk\n- eggs\n- tea\n");
    expect(readdirSync(root).filter((name) => name.endsWith(".md"))).toEqual(["Groceries.md"]);
    model.dispose();
  });
});
