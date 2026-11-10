import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editorMenus, type MenuContext } from "../apps/editor/menus.ts";
import { EditorModel } from "../apps/editor/model.ts";
import { DEFAULT_PREFS, type EditorPrefs } from "../apps/editor/prefs.ts";
import { reservedBy } from "../src/app-menus/reserved.ts";
import { chordFromShortcut } from "../src/app-menus/shortcut.ts";
import { defaultHandlers } from "../src/default-handlers.ts";
import { parseMenus } from "../src/shared/app-menus/protocol.ts";
import { EDITOR_MIME_TYPES, FIRST_PARTY } from "../src/shared/apps/index.ts";

let dir = "";
let clock = 0;
let savedPrefs: EditorPrefs[] = [];
const model = (): EditorModel =>
  new EditorModel({
    loadPrefs: () => DEFAULT_PREFS,
    savePrefs: (prefs) => savedPrefs.push(prefs),
    now: () => (clock += 10_000),
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-editor-model-"));
  savedPrefs = [];
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

describe("view settings", () => {
  test("are kept when they change", () => {
    const editor = model();
    editor.setMonospace(true);
    editor.stepFontSize(1);
    editor.stepFontSize(0);
    expect(savedPrefs).toEqual([
      { monospace: true, fontSize: 13, lineNumbers: true },
      { monospace: true, fontSize: 14, lineNumbers: true },
      { monospace: true, fontSize: 13, lineNumbers: true },
    ]);
    editor.setMonospace(true);
    expect(savedPrefs).toHaveLength(3);
  });
});

describe("menus", () => {
  const ran: string[] = [];
  const record = (name: string) => () => {
    ran.push(name);
  };
  const context = (change: Partial<MenuContext> = {}): MenuContext => ({
    hasFile: true,
    pristine: false,
    hasVersions: true,
    canUndo: false,
    canRedo: false,
    hasSelection: false,
    hasMatches: false,
    monospace: false,
    lineNumbers: true,
    caseSensitive: false,
    actions: {
      newWindow: record("new"),
      open: record("open"),
      close: record("close"),
      save: record("save"),
      saveAs: record("save-as"),
      revertTo: record("revert"),
      deleteDraft: record("delete-draft"),
      undo: record("undo"),
      redo: record("redo"),
      cut: record("cut"),
      copy: record("copy"),
      paste: record("paste"),
      selectAll: record("select-all"),
      find: record("find"),
      findNext: (step) => ran.push(`find:${step}`),
      replace: record("replace"),
      goToLine: record("go-to-line"),
      toggleCase: record("case"),
      toggleLineNumbers: record("line-numbers"),
      toggleMonospace: record("monospace"),
      fontSize: (step) => ran.push(`size:${step}`),
    },
    ...change,
  });

  test("the shell takes them, and no shortcut is one the shell keeps", () => {
    const { menus } = editorMenus(context());
    expect("error" in parseMenus(menus)).toBe(false);
    const shortcuts = menus.flatMap((menu) => menu.items.flatMap((row) => ("shortcut" in row && row.shortcut ? [row.shortcut] : [])));
    expect(shortcuts.length).toBeGreaterThan(10);
    for (const shortcut of shortcuts) {
      const chord = chordFromShortcut(shortcut);
      expect(chord).not.toBeNull();
      if (chord) expect(reservedBy(chord)).toBeNull();
    }
  });

  test("❖W is Close; Revert To lists versions; a draft can be deleted, a file can't", () => {
    const row = (change: Partial<MenuContext>, id: string) =>
      editorMenus(context(change))
        .menus.flatMap((menu) => menu.items)
        .find((each) => "id" in each && each.id === id);
    expect(row({}, "close")).toMatchObject({ label: "Close", shortcut: "❖W" });
    expect(row({}, "revert")).toMatchObject({ label: "Revert To…", enabled: true });
    expect(row({ hasVersions: false }, "revert")).toMatchObject({ enabled: false });
    expect(row({}, "delete-draft")).toMatchObject({ enabled: false });
    expect(row({ hasFile: false }, "delete-draft")).toMatchObject({ enabled: true });
    expect(row({ hasFile: false, pristine: true }, "delete-draft")).toMatchObject({ enabled: false });
    expect(row({}, "go-to-line")).toMatchObject({ label: "Go to Line…", shortcut: "❖L" });
    expect(row({ lineNumbers: true }, "line-numbers")).toMatchObject({ checked: true });
  });

  test("only enabled rows run", () => {
    ran.length = 0;
    const untouched = editorMenus(context({ hasFile: false, pristine: true }));
    untouched.run("save");
    untouched.run("undo");
    untouched.run("find-next");
    untouched.run("bigger");
    untouched.run("nonsense");
    expect(ran).toEqual(["size:1"]);
    const edited = editorMenus(context({ canUndo: true, hasMatches: true }));
    edited.run("save");
    edited.run("undo");
    edited.run("find-previous");
    expect(ran).toEqual(["size:1", "save", "undo", "find:-1"]);
  });

  test("Cut and Copy take a selection; Paste and Select All are always there", () => {
    const rows = (selected: boolean) => editorMenus(context({ hasSelection: selected })).menus.flatMap((menu) => menu.items);
    const row = (selected: boolean, id: string) => rows(selected).find((each) => "id" in each && each.id === id);
    expect(row(false, "cut")).toMatchObject({ label: "Cut", shortcut: "❖X", enabled: false });
    expect(row(false, "copy")).toMatchObject({ label: "Copy", shortcut: "❖C", enabled: false });
    expect(row(true, "copy")).toMatchObject({ enabled: true });
    expect(row(false, "paste")).toMatchObject({ shortcut: "❖V" });
    expect(row(false, "select-all")).toMatchObject({ shortcut: "❖A" });
    expect(row(true, "copy-all")).toBeUndefined();
    ran.length = 0;
    editorMenus(context()).run("copy");
    const selected = editorMenus(context({ hasSelection: true }));
    selected.run("cut");
    selected.run("copy");
    expect(ran).toEqual(["cut", "copy"]);
  });

  test("Undo and Redo name the step, as every app's Edit menu does", () => {
    const rows = (change: Partial<MenuContext>) => editorMenus(context(change)).menus.flatMap((menu) => menu.items);
    const label = (change: Partial<MenuContext>, id: string) => rows(change).find((row) => "id" in row && row.id === id);
    expect(label({ canUndo: true, undoName: "Replace All" }, "undo")).toMatchObject({ label: "Undo Replace All" });
    expect(label({ canRedo: true, redoName: "Typing" }, "redo")).toMatchObject({ label: "Redo Typing" });
    expect(label({ canUndo: false, undoName: "Typing" }, "undo")).toMatchObject({ label: "Undo" });
  });

  test("the document's steps are named: typing joins, Replace All is its own", () => {
    const doc = model();
    doc.edit("hello");
    expect(doc.getSnapshot().undoName).toBe("Typing");
    doc.setQuery("hello");
    doc.replaceAll("bye");
    expect(doc.getSnapshot().undoName).toBe("Replace All");
    doc.undo();
    expect(doc.getSnapshot()).toMatchObject({ text: "hello", undoName: "Typing", redoName: "Replace All" });
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
