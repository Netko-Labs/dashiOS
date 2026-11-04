import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editorMenus, type MenuContext } from "../apps/editor/menus.ts";
import { EditorModel } from "../apps/editor/model.ts";
import { DEFAULT_PREFS, type EditorPrefs } from "../apps/editor/prefs.ts";
import { parseMenus } from "../src/app-menus/protocol.ts";
import { reservedBy } from "../src/app-menus/reserved.ts";
import { chordFromShortcut } from "../src/app-menus/shortcut.ts";
import { defaultHandlers } from "../src/default-handlers.ts";
import { EDITOR_MIME_TYPES, FIRST_PARTY } from "../src/first-party.ts";

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
    expect(editor.getSnapshot().encoding).toBe("latin-1");
    editor.edit("cé€");
    expect(editor.save()).toBe("saved");
    expect(readFileSync(path, "utf8")).toBe("cé€");
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
    editor.revert();
    expect(editor.getSnapshot().text).toBe("start");
    expect(editor.getSnapshot().canUndo).toBe(false);
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
      { monospace: true, fontSize: 13 },
      { monospace: true, fontSize: 14 },
      { monospace: true, fontSize: 13 },
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
    dirty: false,
    hasFile: true,
    canUndo: false,
    canRedo: false,
    canCopy: true,
    hasMatches: false,
    monospace: false,
    caseSensitive: false,
    actions: {
      newWindow: record("new"),
      open: record("open"),
      close: record("close"),
      save: record("save"),
      saveAs: record("save-as"),
      revert: record("revert"),
      undo: record("undo"),
      redo: record("redo"),
      paste: record("paste"),
      selectAll: record("select-all"),
      copyAll: record("copy-all"),
      find: record("find"),
      findNext: (step) => ran.push(`find:${step}`),
      replace: record("replace"),
      toggleCase: record("case"),
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

  test("only enabled rows run", () => {
    ran.length = 0;
    const clean = editorMenus(context());
    clean.run("save");
    clean.run("undo");
    clean.run("find-next");
    clean.run("bigger");
    clean.run("nonsense");
    expect(ran).toEqual(["size:1"]);
    const edited = editorMenus(context({ dirty: true, canUndo: true, hasMatches: true }));
    edited.run("save");
    edited.run("undo");
    edited.run("find-previous");
    expect(ran).toEqual(["size:1", "save", "undo", "find:-1"]);
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
