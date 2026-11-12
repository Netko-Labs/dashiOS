import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultHandlers } from "../src/shared/apps/default-handlers.ts";
import { EDITOR_MIME_TYPES, FIRST_PARTY } from "../src/shared/apps/index.ts";
import { editorModel as model } from "./support/editor-model.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-editor-model-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the document", () => {
  test("Untitled is pristine until typed in, and dirty until saved", () => {
    const editor = model();
    expect(editor.isPristine).toBe(true);
    editor.edit("hello");
    expect(editor.isPristine).toBe(false);
    expect(editor.isDirty).toBe(true);
    expect(editor.save()).toBe("needs-path");
    const path = join(dir, "hello.txt");
    expect(editor.saveAs(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("hello");
    expect(editor.getSnapshot().path).toBe(path);
    expect(editor.isDirty).toBe(false);
  });

  test("opening keeps the line endings and encoding for saving", () => {
    const path = join(dir, "dos.txt");
    writeFileSync(path, "a\r\nb\r\n");
    const editor = model();
    expect(editor.open(path)).toBe(true);
    expect(editor.getSnapshot().text).toBe("a\nb\n");
    editor.edit("a\nb\nc\n");
    expect(editor.save()).toBe("saved");
    expect(readFileSync(path, "utf8")).toBe("a\r\nb\r\nc\r\n");
  });

  test("a character the encoding can't hold saves as UTF-8, and says so", () => {
    const path = join(dir, "latin.txt");
    writeFileSync(path, new Uint8Array([0x63, 0xe9]));
    const editor = model();
    editor.open(path);
    expect(editor.getSnapshot().encoding).toBe("windows-1252");
    editor.edit("cé✓");
    expect(editor.save()).toBe("saved");
    expect(readFileSync(path, "utf8")).toBe("cé✓");
    expect(editor.getSnapshot().encoding).toBe("utf-8");
    expect(editor.getSnapshot().notice?.tone).toBe("info");
  });

  test("a file that can't be opened leaves the document and says why", () => {
    const editor = model();
    editor.edit("kept");
    expect(editor.open(join(dir, "missing.txt"))).toBe(false);
    expect(editor.getSnapshot().text).toBe("kept");
    expect(editor.getSnapshot().notice).toEqual({ text: "“missing.txt” couldn't be opened. There is no such file.", tone: "error" });
  });

  test("a failed save keeps the changes and says why", () => {
    const editor = model();
    editor.edit("x");
    expect(editor.saveAs(join(dir, "nope", "x.txt"))).toBe(false);
    expect(editor.isDirty).toBe(true);
    expect(editor.getSnapshot().notice?.tone).toBe("error");
  });

  test("undo and redo, and Revert to Saved", () => {
    const path = join(dir, "u.txt");
    writeFileSync(path, "start");
    const editor = model();
    editor.open(path);
    editor.edit("start one");
    editor.edit("start one two");
    expect(editor.getSnapshot().canUndo).toBe(true);
    editor.undo();
    expect(editor.getSnapshot().text).toBe("start one");
    editor.redo();
    expect(editor.getSnapshot().text).toBe("start one two");
    expect(editor.revert()).toBe(true);
    expect(editor.getSnapshot().text).toBe("start");
    expect(editor.isDirty).toBe(false);
    // Revert is one Undo step: the changes come back, edited again.
    editor.undo();
    expect(editor.getSnapshot().text).toBe("start one two");
    expect(editor.isDirty).toBe(true);
  });

  test("Revert reads the file as it is now, and says so when it can't", () => {
    const path = join(dir, "v.txt");
    writeFileSync(path, "old");
    const editor = model();
    editor.open(path);
    editor.edit("mine");
    writeFileSync(path, "theirs");
    editor.revert();
    expect(editor.getSnapshot()).toMatchObject({ text: "theirs", saved: "theirs" });
    editor.edit("mine again");
    rmSync(path);
    expect(editor.revert()).toBe(false);
    expect(editor.getSnapshot()).toMatchObject({ text: "mine again", notice: { tone: "error" } });
    expect(model().revert()).toBe(false);
  });

  test("recovered changes are edited against the file as it is", () => {
    const path = join(dir, "r.txt");
    writeFileSync(path, "on disk");
    const editor = model();
    editor.recover({ path, text: "typed", encoding: "utf-8", lineEnding: "lf", time: 1 });
    expect(editor.getSnapshot().saved).toBe("on disk");
    expect(editor.isDirty).toBe(true);
    expect(editor.recovery()).toMatchObject({ path, text: "typed" });
    editor.save();
    expect(editor.recovery()).toBeNull();
  });

  test("nothing to keep while nothing is unsaved", () => {
    expect(model().recovery()).toBeNull();
  });
});

describe("find", () => {
  test("matches follow the text; Find Next asks for a scroll", () => {
    const editor = model();
    editor.edit("one two one two one");
    editor.setQuery("one");
    expect(editor.getSnapshot().find.matches).toEqual([0, 8, 16]);
    expect(editor.findNext(1)).toBe(true);
    expect(editor.findNext(1)).toBe(true);
    expect(editor.getSnapshot().find.current).toBe(1);
    expect(editor.getSnapshot().reveal).toEqual({ offset: 8, seq: 2 });
    editor.findNext(-1);
    editor.findNext(-1);
    expect(editor.getSnapshot().find.current).toBe(2);
    editor.setQuery("zzz");
    expect(editor.findNext(1)).toBe(false);
  });

  test("Replace All is one undo step", () => {
    const editor = model();
    editor.edit("a b a");
    editor.setQuery("a");
    expect(editor.replaceAll("c")).toBe(2);
    expect(editor.getSnapshot().text).toBe("c b c");
    expect(editor.getSnapshot().find.matches).toEqual([]);
    editor.undo();
    expect(editor.getSnapshot().text).toBe("a b a");
  });

  test("Match Case", () => {
    const editor = model();
    editor.edit("A a");
    editor.setQuery("a");
    expect(editor.getSnapshot().find.matches).toHaveLength(2);
    editor.setCaseSensitive(true);
    expect(editor.getSnapshot().find.matches).toEqual([2]);
  });
});

describe("registration", () => {
  test("Text Editor is a first-party app and the default for plain text", () => {
    const spec = FIRST_PARTY.find((each) => each.id === "dev.dashi.editor");
    expect(spec).toMatchObject({ name: "Text Editor", icon: "editor", dir: "editor", defaultHandler: true });
    expect(defaultHandlers(FIRST_PARTY)["text/plain"]).toBe("dev.dashi.editor.desktop");
    expect(new Set(EDITOR_MIME_TYPES).size).toBe(EDITOR_MIME_TYPES.length);
    // No type is claimed by two first-party apps.
    const claimed = FIRST_PARTY.flatMap((each) => each.mimeTypes ?? []);
    expect(new Set(claimed).size).toBe(claimed.length);
  });
});
