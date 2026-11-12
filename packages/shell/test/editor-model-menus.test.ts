import { describe, expect, test } from "bun:test";
import { editorMenus, type MenuContext } from "../apps/editor/lib/menus.ts";
import type { EditorPrefs } from "../apps/editor/lib/prefs.ts";
import { reservedBy } from "../src/app-menus/lib/reserved.ts";
import { chordFromShortcut } from "../src/app-menus/shortcut.ts";
import { parseMenus } from "../src/shared/app-menus/protocol.ts";
import { editorModel as model } from "./support/editor-model.ts";

describe("view settings", () => {
  test("are kept when they change", () => {
    const saved: EditorPrefs[] = [];
    const editor = model(saved);
    editor.setMonospace(true);
    editor.stepFontSize(1);
    editor.stepFontSize(0);
    expect(saved).toEqual([
      { monospace: true, fontSize: 13, lineNumbers: true, tabWidth: 4 },
      { monospace: true, fontSize: 14, lineNumbers: true, tabWidth: 4 },
      { monospace: true, fontSize: 13, lineNumbers: true, tabWidth: 4 },
    ]);
    editor.setMonospace(true);
    expect(saved).toHaveLength(3);
    // The tab stops' width is a View setting like the others; the one in use is not saved again.
    editor.setTabWidth(8);
    expect(saved.at(-1)).toEqual({ monospace: true, fontSize: 13, lineNumbers: true, tabWidth: 8 });
    editor.setTabWidth(8);
    expect(saved).toHaveLength(4);
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
    tabWidth: 4,
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
      tabWidth: (width) => ran.push(`tab:${width}`),
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

  test("View has the tab stops' width, the one in use ticked, and a press sets it", () => {
    const row = (change: Partial<MenuContext>, id: string) =>
      editorMenus(context(change))
        .menus.flatMap((menu) => menu.items)
        .find((each) => "id" in each && each.id === id);
    expect(row({}, "tab-width-4")).toMatchObject({ label: "Tab Width: 4", checked: true });
    expect(row({}, "tab-width-8")).toMatchObject({ label: "Tab Width: 8", checked: false });
    expect(row({ tabWidth: 2 }, "tab-width-2")).toMatchObject({ checked: true });
    ran.length = 0;
    editorMenus(context()).run("tab-width-8");
    expect(ran).toEqual(["tab:8"]);
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
