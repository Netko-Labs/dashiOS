import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineCount, lineStart } from "../apps/editor/lib/find.ts";
import { EditorModel } from "../apps/editor/lib/model.ts";
import { DEFAULT_PREFS, type EditorPrefs } from "../apps/editor/lib/prefs.ts";
import { countsLine, findHighlights, findPlace, titleDetail } from "../apps/editor/lib/status.ts";
import {
  AUTO_EVERY,
  MAX_VERSIONS,
  thinVersions,
  type Version,
  VersionStore,
  versionDifference,
  versionKindLabel,
  versionsDir,
  versionWhen,
} from "../apps/editor/lib/versions.ts";
import { gutterWidth } from "../apps/editor/lib/views/text-area.tsx";

let dir = "";
let clock = 0;
const MINUTE = 60_000;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-editor-autosave-"));
  // Just after the files the tests write: a version of a file as opened is from when it was written.
  clock = Date.now() + MINUTE;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(prefs: { value: EditorPrefs } = { value: DEFAULT_PREFS }) {
  const versions = new VersionStore(join(dir, "versions"));
  const editor = new EditorModel({ loadPrefs: () => prefs.value, savePrefs: () => {}, versions, now: () => clock });
  return { editor, versions };
}

/** Writes `text` to `path` as another app would, with a modified time `ms` later than the file had. */
function writeElsewhere(path: string, text: string, ms = 5000): void {
  const before = statSync(path).mtimeMs;
  writeFileSync(path, text);
  utimesSync(path, new Date(before + ms), new Date(before + ms));
}

describe("saving on its own", () => {
  test("a file is written without asking; Untitled stays a draft", () => {
    const path = join(dir, "notes.txt");
    writeFileSync(path, "one");
    const { editor } = setup();
    editor.open(path);
    expect(editor.autosave()).toBe("clean");
    editor.edit("one two");
    expect(editor.autosave()).toBe("saved");
    expect(readFileSync(path, "utf8")).toBe("one two");
    expect(editor.isDirty).toBe(false);
    expect(editor.recovery()).toBeNull();

    const { editor: draft } = setup();
    draft.edit("an idea");
    expect(draft.autosave()).toBe("draft");
    expect(draft.recovery()).toMatchObject({ path: null, text: "an idea" });
  });

  test("the file as it was opened is kept as a version before it is first written over", () => {
    const path = join(dir, "notes.txt");
    writeFileSync(path, "as opened");
    const { editor, versions } = setup();
    editor.open(path);
    editor.edit("first change");
    editor.autosave();
    editor.edit("second change");
    clock += MINUTE;
    editor.autosave();
    // One version: the file as opened; the next autosave is too soon for another.
    const kept = versions.list(path);
    expect(kept.map((version) => version.kind)).toEqual(["opened"]);
    expect(versions.read(path, kept[0] as Version)).toBe("as opened");
    // After a while, what is about to be replaced is kept again.
    clock += AUTO_EVERY;
    editor.edit("third change");
    editor.autosave();
    expect(versions.list(path).map((version) => version.kind)).toEqual(["auto", "opened"]);
    expect(versions.read(path, versions.list(path)[0] as Version)).toBe("second change");
  });

  test("❖S keeps the text as a version; Revert To brings one back as one Undo step", () => {
    const path = join(dir, "notes.txt");
    writeFileSync(path, "draft one");
    const { editor } = setup();
    editor.open(path);
    editor.edit("draft two");
    clock += MINUTE;
    expect(editor.save()).toBe("saved");
    editor.edit("draft three");
    editor.autosave();
    const listed = editor.listVersions();
    expect(listed.map((version) => version.kind)).toEqual(["saved", "opened"]);
    expect(editor.versionText(listed[0] as Version)).toBe("draft two");

    // A tick later, so the version Revert keeps is the newest: two versions from one
    // millisecond list in the folder's order, which differs between file systems.
    clock += 1;
    expect(editor.revertTo(listed[1] as Version)).toBe(true);
    expect(editor.getSnapshot()).toMatchObject({ text: "draft one", undoName: "Revert" });
    editor.autosave();
    expect(readFileSync(path, "utf8")).toBe("draft one");
    // What it replaced is a version too, and Undo brings it back.
    expect(editor.versionText(editor.listVersions()[0] as Version)).toBe("draft three");
    editor.undo();
    expect(editor.getSnapshot().text).toBe("draft three");
  });

  test("kept changes that come back wait for the next edit before they are written", () => {
    const path = join(dir, "kept.txt");
    writeFileSync(path, "on disk");
    const { editor } = setup();
    editor.recover({ path, text: "kept", encoding: "utf-8", lineEnding: "lf", time: 1 });
    expect(editor.autosave()).toBe("draft");
    expect(readFileSync(path, "utf8")).toBe("on disk");
    expect(editor.getSnapshot().notice?.text).toContain("saved once you edit again");
    editor.edit("kept, and more");
    expect(editor.autosave()).toBe("saved");
    expect(readFileSync(path, "utf8")).toBe("kept, and more");
  });

  test("Untitled has no versions", () => {
    const { editor } = setup();
    editor.edit("x");
    expect(editor.listVersions()).toEqual([]);
  });
});

describe("changes made elsewhere", () => {
  test("come in quietly while nothing is unsaved here, and Undo brings back what was here", () => {
    const path = join(dir, "shared.txt");
    writeFileSync(path, "mine");
    const { editor } = setup();
    editor.open(path);
    editor.checkDisk();
    expect(editor.getSnapshot().text).toBe("mine");
    writeElsewhere(path, "theirs");
    editor.checkDisk();
    expect(editor.getSnapshot()).toMatchObject({ text: "theirs", saved: "theirs", conflict: null, notice: { tone: "info" } });
    editor.undo();
    expect(editor.getSnapshot().text).toBe("mine");
  });

  test("are never written over: the conflict asks, and either side can win", () => {
    const path = join(dir, "shared.txt");
    writeFileSync(path, "start");
    const { editor } = setup();
    editor.open(path);
    editor.edit("start, mine");
    writeElsewhere(path, "start, theirs");
    expect(editor.autosave()).toBe("conflict");
    expect(editor.getSnapshot().conflict).toBe("changed");
    expect(readFileSync(path, "utf8")).toBe("start, theirs");
    expect(editor.save()).toBe("conflict");
    // Unsaved here, so it is kept as a draft meanwhile.
    expect(editor.recovery()).toMatchObject({ text: "start, mine" });

    expect(editor.keepMine()).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("start, mine");
    expect(editor.getSnapshot().conflict).toBeNull();

    editor.edit("start, mine again");
    writeElsewhere(path, "theirs again");
    editor.checkDisk();
    expect(editor.getSnapshot().conflict).toBe("changed");
    expect(editor.revert("Use the One on Disk")).toBe(true);
    expect(editor.getSnapshot()).toMatchObject({ text: "theirs again", conflict: null });
    editor.undo();
    expect(editor.getSnapshot().text).toBe("start, mine again");
  });

  test("a file that went away is a conflict once there is something to write", () => {
    const path = join(dir, "gone.txt");
    writeFileSync(path, "here");
    const { editor } = setup();
    editor.open(path);
    rmSync(path);
    editor.checkDisk();
    expect(editor.getSnapshot().conflict).toBeNull();
    editor.edit("here still");
    expect(editor.autosave()).toBe("conflict");
    expect(editor.getSnapshot().conflict).toBe("gone");
    // Save It There writes it back.
    expect(editor.keepMine()).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("here still");
  });

  test("View settings changed in another window are followed", () => {
    const prefs = { value: DEFAULT_PREFS };
    const { editor } = setup(prefs);
    prefs.value = { ...DEFAULT_PREFS, lineNumbers: false };
    editor.reloadPrefs();
    expect(editor.getSnapshot().prefs.lineNumbers).toBe(false);
  });
});

describe("versions", () => {
  test("are kept only the person's, and the same text isn't kept twice", () => {
    const store = new VersionStore(join(dir, "v"));
    expect(store.add("/home/a/x.txt", "one", "opened", 1000, 2000)).toBe(true);
    expect(store.add("/home/a/x.txt", "one", "auto", 1500, 2000)).toBe(false);
    expect(store.add("/home/a/x.txt", "two", "saved", 1800, 2000)).toBe(true);
    expect(store.list("/home/a/x.txt")).toEqual([
      { time: 1800, kind: "saved" },
      { time: 1000, kind: "opened" },
    ]);
    expect(store.list("/home/a/y.txt")).toEqual([]);
    expect(store.newest("/home/a/x.txt")).toBe(1800);
    const [folder] = readdirSync(join(dir, "v"));
    expect(statSync(join(dir, "v", folder as string)).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "v", folder as string, "1800-saved.txt")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, "v", folder as string, "path"), "utf8")).toBe("/home/a/x.txt");
    expect(versionsDir({ XDG_STATE_HOME: "/s" })).toBe("/s/dashi/editor/versions");
  });

  test("thin out: all of the last hour, one an hour for a day, one a day for a month", () => {
    const Hour = 60 * MINUTE;
    const Day = 24 * Hour;
    const now = 100 * Day;
    const at = (age: number): Version => ({ time: now - age, kind: "auto" });
    const versions = [
      at(1 * MINUTE),
      at(20 * MINUTE),
      at(2 * Hour + 5 * MINUTE),
      at(2 * Hour + 30 * MINUTE),
      at(2 * Day + Hour),
      at(2 * Day + 2 * Hour),
      at(40 * Day),
    ].sort((a, b) => b.time - a.time);
    const kept = thinVersions(versions, now).map((version) => now - version.time);
    expect(kept).toEqual([1 * MINUTE, 20 * MINUTE, 2 * Hour + 5 * MINUTE, 2 * Day + Hour]);
    // The newest is kept however old it is.
    expect(thinVersions([at(90 * Day)], now)).toHaveLength(1);
    const many = Array.from({ length: 100 }, (_, index) => at(index * 1000));
    expect(thinVersions(many, now)).toHaveLength(MAX_VERSIONS);
  });

  test("are named by when they are from, and say how they differ", () => {
    const now = new Date(2026, 10, 6, 15, 0).getTime();
    expect(versionWhen(new Date(2026, 10, 6, 10, 42).getTime(), now)).toBe("Today 10:42");
    expect(versionWhen(new Date(2026, 10, 5, 18, 3).getTime(), now)).toBe("Yesterday 18:03");
    expect(versionWhen(new Date(2026, 10, 3, 9, 15).getTime(), now)).toBe("Tuesday 09:15");
    expect(versionWhen(new Date(2026, 9, 2, 9, 15).getTime(), now)).toBe("Oct 2 09:15");
    expect(versionWhen(new Date(2025, 9, 2, 9, 15).getTime(), now)).toBe("Oct 2, 2025");
    expect(versionKindLabel("opened")).toBe("As opened");
    expect(versionKindLabel("auto")).toBeNull();
    expect(versionDifference("a\nb\nc", "a\nb\nc")).toBe("Same as now");
    expect(versionDifference("a\nb\nc", "a\nB\nc")).toBe("Differs from line 2");
  });
});

describe("the window's words and marks", () => {
  test("Find's place fits its field; the folder follows the title; the counts and an unusual encoding share the chip", () => {
    const find = { query: "one", caseSensitive: false, matches: [0, 8, 16], current: -1 };
    expect(findPlace({ ...find, query: "" })).toBeNull();
    expect(findPlace({ ...find, matches: [] })).toBe("Not found");
    expect(findPlace(find)).toBe("3 matches");
    expect(findPlace({ ...find, matches: [0], current: -1 })).toBe("1 match");
    expect(findPlace({ ...find, current: 1 })).toBe("2 of 3");
    expect(titleDetail("~/Documents")).toBe("~/Documents");
    expect(titleDetail(null)).toBe("Draft");
    expect(countsLine({ counts: "2 words", encoding: "utf-8", lineEnding: "lf" })).toBe("2 words");
    expect(countsLine({ counts: "2 words", encoding: "windows-1252", lineEnding: "crlf" })).toBe("2 words · Western (Windows) · CRLF");
    expect(countsLine({ counts: "2 words", encoding: "utf-8", lineEnding: "crlf" })).toBe("2 words · UTF-8 · CRLF");
  });

  test("every match is highlighted, the current one deeper", () => {
    const find = { query: "one", caseSensitive: false, matches: [0, 8], current: 1 };
    expect(findHighlights(find, "#wash", "#deep")).toEqual([
      { start: 0, end: 3, color: "#wash" },
      { start: 8, end: 11, color: "#deep" },
    ]);
    expect(findHighlights({ ...find, query: "" }, "#wash", "#deep")).toEqual([]);
  });

  test("Go to Line, and the gutter's width", () => {
    const text = "one\ntwo\nthree";
    expect(lineCount(text)).toBe(3);
    expect(lineCount("")).toBe(1);
    expect(lineStart(text, 1)).toBe(0);
    expect(lineStart(text, 3)).toBe(8);
    expect(lineStart(text, 99)).toBe(8);
    expect(gutterWidth(9, 13)).toBe(gutterWidth(99, 13));
    expect(gutterWidth(1000, 13)).toBeGreaterThan(gutterWidth(99, 13));
  });
});
