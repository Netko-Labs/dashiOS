import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, pathFromArg } from "../apps/editor/args.ts";
import { MAX_BYTES, readDocument, writeDocument } from "../apps/editor/files.ts";
import { displayName, folderLabel, resolveInput, suggestedSavePath, tildePath } from "../apps/editor/names.ts";
import { DEFAULT_PREFS, parsePrefs, prefsPath, readPrefs, stepFontSize, writePrefs } from "../apps/editor/prefs.ts";
import {
  isOpenWindow,
  keepRecovery,
  moveOldRecovery,
  parseRecovery,
  type Recovery,
  RecoveryKeeper,
  recoveryDir,
  recoveryFiles,
  recoveryFor,
  takeRecovery,
} from "../apps/editor/recovery.ts";
import { windowCommand } from "../apps/editor/windows.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-editor-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("args", () => {
  test("files as paths or file:// URLs, the host, and a recovery file", () => {
    expect(parseArgs(["--host", "/h", "a.txt", "file:///tmp/b%20c.txt", "https://x.org/y"])).toEqual({
      host: "/h",
      files: ["a.txt", "/tmp/b c.txt"],
      recover: null,
    });
    expect(parseArgs(["--recover", "1-2.json"])).toEqual({ host: null, files: [], recover: "1-2.json" });
    expect(parseArgs(["--", "--odd-name"]).files).toEqual(["--odd-name"]);
    expect(pathFromArg("")).toBeNull();
    expect(pathFromArg("a\0b")).toBeNull();
    expect(pathFromArg("notes:2024.txt")).toBe("notes:2024.txt");
  });

  test("another window's command line reads back the same", () => {
    const command = windowCommand({ bun: "/bun", main: "/m.tsx", host: "/host" }, ["--x.txt"]);
    expect(command).toEqual(["/bun", "/m.tsx", "--host", "/host", "--", "--x.txt"]);
    expect(parseArgs(command.slice(2))).toEqual({ host: "/host", files: ["--x.txt"], recover: null });
    expect(parseArgs(windowCommand({ bun: "/bun", main: "/m.tsx", host: "/host" }, [], "1-2.json").slice(2)).recover).toBe("1-2.json");
  });
});

describe("names", () => {
  test("the title and the folder after it", () => {
    expect(displayName(null)).toBe("Untitled");
    expect(displayName("/home/a/notes.txt")).toBe("notes.txt");
    expect(folderLabel("/home/a/Documents/x.txt", "/home/a")).toBe("~/Documents");
    expect(folderLabel("/etc/hosts", "/home/a")).toBe("/etc");
    expect(folderLabel(null, "/home/a")).toBeNull();
    expect(tildePath("/home/ab/x", "/home/a")).toBe("/home/ab/x");
  });

  test("a typed location: ~, relative, absolute", () => {
    expect(resolveInput("~/x.txt", "/base", "/home/a")).toBe("/home/a/x.txt");
    expect(resolveInput("~", "/base", "/home/a")).toBe("/home/a");
    expect(resolveInput(" sub/../x.txt ", "/base", "/home/a")).toBe("/base/x.txt");
    expect(resolveInput("/etc/hosts", "/base", "/home/a")).toBe("/etc/hosts");
    expect(resolveInput("  ", "/base", "/home/a")).toBeNull();
    expect(resolveInput("a\0", "/base", "/home/a")).toBeNull();
  });

  test("where Save As starts", () => {
    expect(suggestedSavePath(null, "/home/a")).toBe("~/Documents/Untitled.txt");
    expect(suggestedSavePath(null, "/home/a", false)).toBe("~/Untitled.txt");
    expect(suggestedSavePath("/home/a/n.md", "/home/a")).toBe("~/n.md");
    // An Untitled.txt there already: the next free name.
    const taken = new Set(["/home/a/Documents/Untitled.txt", "/home/a/Documents/Untitled 2.txt"]);
    expect(suggestedSavePath(null, "/home/a", true, (path) => taken.has(path))).toBe("~/Documents/Untitled 3.txt");
    expect(suggestedSavePath(null, "/home/a", false, (path) => taken.has(path))).toBe("~/Untitled.txt");
  });
});

describe("files", () => {
  test("reads text, refuses folders, binaries, and large files", () => {
    const text = join(dir, "a.txt");
    writeFileSync(text, "one\r\ntwo\r\n");
    expect(readDocument(text)).toEqual({
      ok: true,
      decoded: { text: "one\ntwo\n", encoding: "utf-8", lineEnding: "crlf" },
      stamp: { mtimeMs: statSync(text).mtimeMs, size: 10 },
    });
    expect(readDocument(dir)).toEqual({ ok: false, message: "It is a folder." });
    expect(readDocument(join(dir, "none"))).toEqual({ ok: false, message: "There is no such file." });
    const binary = join(dir, "b.bin");
    writeFileSync(binary, new Uint8Array([1, 0, 2]));
    expect(readDocument(binary).ok).toBe(false);
    const large = join(dir, "large.txt");
    writeFileSync(large, new Uint8Array(MAX_BYTES + 1).fill(0x61));
    expect(readDocument(large).ok).toBe(false);
  });

  test("writes keep the file's permissions and go through a symlink", () => {
    const target = join(dir, "script.sh");
    writeFileSync(target, "old");
    chmodSync(target, 0o755);
    const link = join(dir, "link.sh");
    symlinkSync(target, link);
    expect(writeDocument(link, new TextEncoder().encode("new"))).toBeNull();
    expect(readFileSync(target, "utf8")).toBe("new");
    expect(statSync(target).mode & 0o777).toBe(0o755);
    expect(statSync(link).isSymbolicLink() || existsSync(link)).toBe(true);
    // No temp file left beside it.
    expect(readdirSync(dir).sort()).toEqual(["link.sh", "script.sh"]);
  });

  test("a new file, and a folder that isn't there", () => {
    expect(writeDocument(join(dir, "new.txt"), new TextEncoder().encode("x"))).toBeNull();
    expect(readFileSync(join(dir, "new.txt"), "utf8")).toBe("x");
    expect(writeDocument(join(dir, "missing", "new.txt"), new Uint8Array())).toBe("That folder doesn't exist.");
  });

  test("a writable file in a folder that isn't is written in place", () => {
    if (process.getuid?.() === 0) return; // root writes anywhere
    const locked = join(dir, "locked");
    mkdirSync(locked);
    const file = join(locked, "f.txt");
    writeFileSync(file, "old");
    chmodSync(locked, 0o555);
    try {
      expect(writeDocument(file, new TextEncoder().encode("new"))).toBeNull();
      expect(readFileSync(file, "utf8")).toBe("new");
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});

describe("recovery", () => {
  const sample: Recovery = { path: "/home/a/x.txt", text: "unsaved", encoding: "utf-8", lineEnding: "crlf", time: 1000 };

  test("drafts live under the state folder; 0.4's recovery folder becomes it", () => {
    expect(recoveryDir({ XDG_STATE_HOME: "/s" })).toBe("/s/dashi/editor/drafts");
    expect(recoveryDir({ HOME: "/home/a" })).toBe("/home/a/.local/state/dashi/editor/drafts");
    const env = { XDG_STATE_HOME: join(dir, "state") };
    const old = join(dir, "state", "dashi", "editor", "recovery");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "1-2.json"), JSON.stringify(sample));
    moveOldRecovery(env);
    expect(readdirSync(recoveryDir(env))).toEqual(["1-2.json"]);
    expect(existsSync(old)).toBe(false);
    moveOldRecovery(env);
    expect(readdirSync(recoveryDir(env))).toEqual(["1-2.json"]);
  });

  test("parsing refuses what isn't one", () => {
    expect(parseRecovery(JSON.stringify(sample))).toEqual(sample);
    expect(parseRecovery(JSON.stringify({ ...sample, path: null }))?.path).toBeNull();
    expect(parseRecovery(JSON.stringify({ ...sample, encoding: "utf-7" }))).toBeNull();
    expect(parseRecovery(JSON.stringify({ ...sample, path: "" }))).toBeNull();
    expect(parseRecovery(JSON.stringify({ ...sample, text: 3 }))).toBeNull();
    expect(parseRecovery("not json")).toBeNull();
  });

  test("kept files are the person's, oldest first, and taken once", () => {
    const store = join(dir, "recovery");
    expect(keepRecovery({ ...sample, time: 2000 }, store)).toBe(true);
    expect(keepRecovery(sample, store)).toBe(true);
    writeFileSync(join(store, "stray.json"), "{}");
    expect(statSync(store).mode & 0o777).toBe(0o700);
    const names = recoveryFiles(store);
    expect(names).toHaveLength(2);
    expect(statSync(join(store, names[0] as string)).mode & 0o777).toBe(0o600);
    expect(takeRecovery(names[0] as string, store)?.time).toBe(1000);
    expect(takeRecovery(names[0] as string, store)).toBeNull();
    expect(takeRecovery("../x.json", store)).toBeNull();
    expect(recoveryFiles(store)).toHaveLength(1);
    expect(recoveryFiles(join(dir, "none"))).toEqual([]);
  });

  test("a window that is still open keeps its file: nobody takes it", () => {
    const store = join(dir, "recovery");
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, "100-41.json"), JSON.stringify(sample));
    writeFileSync(join(store, "200-42.json"), JSON.stringify({ ...sample, path: "/home/a/y.txt", time: 2000 }));
    writeFileSync(join(store, "300-41.json"), JSON.stringify({ ...sample, time: 3000 }));
    const open = (pid: number): boolean => pid === 42;
    expect(recoveryFiles(store, open)).toEqual(["100-41.json", "300-41.json"]);
    // Opening a file finds the newest changes kept for it.
    expect(recoveryFor("/home/a/x.txt", store, open)).toBe("300-41.json");
    expect(recoveryFor("/home/a/y.txt", store, open)).toBeNull();
    expect(recoveryFor("/home/a/y.txt", store, () => false)).toBe("200-42.json");
    // This process is never another open window.
    expect(isOpenWindow(process.pid)).toBe(false);
  });
});

describe("keeping changes as they are typed", () => {
  let unsaved: Recovery | null = null;
  const keeper = (store: string, delay = 20) => new RecoveryKeeper(() => unsaved, { dir: store, delay, now: () => 1234 });
  const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
  const sample: Recovery = { path: "/home/a/x.txt", text: "one", encoding: "utf-8", lineEnding: "lf", time: 1000 };

  test("a change is kept once typing stops, in one file of the window's own, and only the person's", async () => {
    const store = join(dir, "recovery");
    const kept = keeper(store);
    expect(kept.name).toBe(`1234-${process.pid}.json`);
    unsaved = sample;
    kept.changed();
    unsaved = { ...sample, text: "one two" };
    kept.changed();
    expect(existsSync(join(store, kept.name))).toBe(false);
    await wait(60);
    expect(readdirSync(store)).toEqual([kept.name]);
    expect(parseRecovery(readFileSync(join(store, kept.name), "utf8"))?.text).toBe("one two");
    expect(statSync(join(store, kept.name)).mode & 0o777).toBe(0o600);
    expect(statSync(store).mode & 0o777).toBe(0o700);
  });

  test("saving removes it; Don't Save drops it; nothing is written while nothing is unsaved", async () => {
    const store = join(dir, "recovery");
    const kept = keeper(store);
    unsaved = null;
    expect(kept.flush()).toBe(true);
    expect(existsSync(store)).toBe(false);
    unsaved = sample;
    kept.flush();
    expect(existsSync(join(store, kept.name))).toBe(true);
    unsaved = null;
    kept.changed();
    await wait(60);
    expect(readdirSync(store)).toEqual([]);
    unsaved = sample;
    kept.flush();
    kept.changed();
    kept.discard();
    await wait(60);
    expect(readdirSync(store)).toEqual([]);
  });

  test("a crash leaves the last kept text for the next window, which takes it", () => {
    const store = join(dir, "recovery");
    const kept = keeper(store, 10_000);
    unsaved = { ...sample, text: "typed before the crash" };
    kept.flush();
    // The process is gone (no exit handler ran); the next window looks.
    const [name] = recoveryFiles(store, () => false);
    expect(name).toBe(kept.name);
    expect(takeRecovery(name as string, store)?.text).toBe("typed before the crash");
    expect(readdirSync(store)).toEqual([]);
  });
});

describe("prefs", () => {
  test("parsing keeps what is valid", () => {
    expect(parsePrefs('{"monospace":true,"fontSize":16}')).toEqual({ monospace: true, fontSize: 16, lineNumbers: true });
    expect(parsePrefs('{"lineNumbers":false}')).toEqual({ ...DEFAULT_PREFS, lineNumbers: false });
    expect(parsePrefs('{"monospace":"yes","fontSize":15}')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("[]")).toEqual(DEFAULT_PREFS);
    expect(prefsPath({ XDG_CONFIG_HOME: "/c" })).toBe("/c/dashi/editor.json");
  });

  test("sizes step along the list and stop at its ends", () => {
    expect(stepFontSize(13, 1)).toBe(14);
    expect(stepFontSize(13, -1)).toBe(12);
    expect(stepFontSize(15, 1)).toBe(16);
    expect(stepFontSize(15, -1)).toBe(14);
    expect(stepFontSize(32, 1)).toBe(32);
    expect(stepFontSize(10, -1)).toBe(10);
  });

  test("written and read back", () => {
    const path = join(dir, "config", "editor.json");
    writePrefs({ monospace: true, fontSize: 18, lineNumbers: false }, path);
    expect(readPrefs(path)).toEqual({ monospace: true, fontSize: 18, lineNumbers: false });
    expect(readPrefs(join(dir, "none.json"))).toEqual(DEFAULT_PREFS);
  });
});
