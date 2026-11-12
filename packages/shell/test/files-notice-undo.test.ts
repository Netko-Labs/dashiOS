import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "../src/shared/file-browser/env.ts";
import { folderAt } from "../src/shared/file-browser/location.ts";
import { Operations } from "../src/shared/file-browser/operations.ts";
import { FilesStore } from "../src/shared/file-browser/store.ts";
import type { Exec } from "../src/shared/files/exec.ts";
import type { FileItem } from "../src/shared/files/items.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

fakeClockEachTest();

let root = "";
let home = "";
let trash = { files: "", info: "" };

/** `gio trash` as the Trash specification has it: the item into files/, its origin into info/. */
const fakeGio: Exec = async (command) => {
  const path = command.at(-1) as string;
  const name = path.split("/").at(-1) as string;
  renameSync(path, join(trash.files, name));
  writeFileSync(join(trash.info, `${name}.trashinfo`), `[Trash Info]\nPath=${encodeURI(path)}\nDeletionDate=2026-11-06T02:00:00\n`);
  return { ok: true, code: 0, stdout: "", stderr: "" };
};

function files(noticeFadeMs = 20): { store: FilesStore; ops: Operations; folder: string } {
  const folder = join(home, "UndoTest");
  mkdirSync(folder, { recursive: true });
  const env = {
    home,
    user: "alexk",
    run: fakeGio,
    trash,
    dirs: [],
    now: Date.now,
    recents: async () => [],
  } as unknown as Env;
  const store = new FilesStore(env, folderAt(folder), { watch: false, noticeFadeMs });
  return { store, ops: new Operations(store), folder };
}

const item = (path: string): FileItem => ({ path }) as FileItem;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "files-notice-"));
  home = join(root, "home");
  trash = { files: join(root, "trash", "files"), info: join(root, "trash", "info") };
  for (const dir of [home, trash.files, trash.info]) mkdirSync(dir, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("the Trash notice keeps its Undo past the fade, so a late click still lands on it", async () => {
  const { store, ops, folder } = files();
  writeFileSync(join(folder, "a.txt"), "a");
  await ops.trash([item(join(folder, "a.txt"))]);
  const notice = store.getSnapshot().notice;
  expect(notice?.text).toBe("Moved “a.txt” to the Trash.");
  expect(notice?.undoStep).toBe(ops.undo.state.undoStep as number);
  // Long past the fade of a notice that only informs: it was here that the notice
  // went as Undo was clicked, and the click fell through to the files.
  await settle(100);
  expect(store.getSnapshot().notice?.id).toBe(notice?.id as number);
  await ops.undoStep("undo");
  expect(existsSync(join(folder, "a.txt"))).toBe(true);
  expect(store.getSnapshot().notice).toBeNull();
  store.stop();
});

test("a notice that only informs still fades", async () => {
  const { store } = files();
  store.say("Copied “a.txt” for pasting in Files.");
  await settle(100);
  expect(store.getSnapshot().notice).toBeNull();
  store.stop();
});

test("the notice's Undo is for its own step: a newer step takes the notice down", async () => {
  const { store, ops, folder } = files();
  writeFileSync(join(folder, "a.txt"), "a");
  await ops.trash([item(join(folder, "a.txt"))]);
  expect(store.getSnapshot().notice?.undoStep).toBeDefined();
  // New Folder says nothing in the footer; before, the Trash notice's Undo then took back the folder.
  expect(await ops.newFolder()).toEqual({ path: join(folder, "untitled folder") });
  expect(ops.undo.state.undoName).toBe("New Folder");
  expect(store.getSnapshot().notice).toBeNull();
  store.stop();
});

test("an Undo that couldn't run leaves the notice up", async () => {
  const { store, ops } = files();
  store.say("Moved “a.txt” to the Trash.", false, 41);
  // Nothing on the stack: Undo doesn't run, and the notice doesn't pretend it did.
  await ops.undoStep("undo");
  expect(store.getSnapshot().notice?.text).toBe("Moved “a.txt” to the Trash.");
  store.stop();
});

test("a typed path's error stays until a path works, and goes then; another error is left alone", () => {
  const { store, folder } = files();
  const problem = store.goToPath("~~/UndoTest");
  expect(problem).not.toBeNull();
  store.sayPathProblem(problem as string);
  expect(store.getSnapshot().notice?.error).toBe(true);
  expect(store.goToPath("~/UndoTest")).toBeNull();
  expect(store.getSnapshot().location).toEqual(folderAt(folder));
  expect(store.getSnapshot().notice).toBeNull();
  // An error of something else (a copy that failed) isn't the path field's to take down.
  store.say("“a.txt” couldn’t be copied.", true);
  expect(store.goToPath("~")).toBeNull();
  expect(store.getSnapshot().notice?.text).toBe("“a.txt” couldn’t be copied.");
});
