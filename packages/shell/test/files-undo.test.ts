import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UndoStack } from "@dashi/ui";
import { copyAction, moveAction, newFolderAction, renameAction, trashAction, type UndoEnv } from "../src/shared/file-browser/lib/operations/undoable.ts";
import type { Exec } from "../src/shared/files/exec.ts";
import { findTrashed } from "../src/shared/files/trashops.ts";

let root = "";
let home = "";
let trash = { files: "", info: "" };
let refreshed: string[][] = [];

/** `gio trash` as the Trash specification has it: the item into files/, its origin into info/. */
const fakeGio: Exec = async (command) => {
  const path = command.at(-1) as string;
  const name = path.split("/").at(-1) as string;
  renameSync(path, join(trash.files, name));
  writeFileSync(join(trash.info, `${name}.trashinfo`), `[Trash Info]\nPath=${encodeURI(path)}\nDeletionDate=2026-11-06T02:00:00\n`);
  return { ok: true, code: 0, stdout: "", stderr: "" };
};

function env(): UndoEnv {
  return { trash, home, run: fakeGio, refresh: (paths) => void refreshed.push([...paths]) };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "files-undo-"));
  home = join(root, "home");
  trash = { files: join(root, "trash", "files"), info: join(root, "trash", "info") };
  for (const dir of [home, trash.files, trash.info]) mkdirSync(dir, { recursive: true });
  refreshed = [];
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("Rename undoes to the old name and redoes to the new one", async () => {
  const stack = new UndoStack();
  writeFileSync(join(home, "draft.txt"), "x");
  renameSync(join(home, "draft.txt"), join(home, "final.txt"));
  stack.push(renameAction(join(home, "draft.txt"), join(home, "final.txt"), env()));
  expect(stack.state.undoName).toBe("Rename");
  await stack.undo();
  expect(existsSync(join(home, "draft.txt"))).toBe(true);
  expect(existsSync(join(home, "final.txt"))).toBe(false);
  expect(refreshed.at(-1)).toEqual([join(home, "draft.txt")]);
  await stack.redo();
  expect(existsSync(join(home, "final.txt"))).toBe(true);
});

test("New Folder undoes by removing it while empty, and to the Trash once it holds something", async () => {
  const stack = new UndoStack();
  const folder = join(home, "untitled folder");
  mkdirSync(folder);
  stack.push(newFolderAction(folder, env()));
  await stack.undo();
  expect(existsSync(folder)).toBe(false);
  await stack.redo();
  expect(existsSync(folder)).toBe(true);
  writeFileSync(join(folder, "kept.txt"), "x");
  await stack.undo();
  expect(existsSync(folder)).toBe(false);
  expect(existsSync(join(trash.files, "untitled folder", "kept.txt"))).toBe(true);
});

test("Move to Trash puts back from the Trash, and redo trashes again", async () => {
  const stack = new UndoStack();
  const file = join(home, "notes.txt");
  writeFileSync(file, "hello");
  await fakeGio(["gio", "trash", "--", file]);
  expect(await findTrashed(file, trash)).toBe(join(trash.files, "notes.txt"));
  stack.push(trashAction([file], env()));
  expect(stack.state.undoName).toBe("Move to Trash");
  await stack.undo();
  expect(readFileSync(file, "utf8")).toBe("hello");
  expect(await findTrashed(file, trash)).toBeNull();
  await stack.redo();
  expect(existsSync(file)).toBe(false);
});

test("Undo of Move to Trash says so when the item left the Trash", async () => {
  const stack = new UndoStack();
  const file = join(home, "gone.txt");
  stack.push(trashAction([file], env()));
  await expect(stack.undo()).rejects.toThrow("“gone.txt” isn’t in the Trash any more.");
});

test("Move moves back where each came from", async () => {
  const stack = new UndoStack();
  const docs = join(home, "Documents");
  mkdirSync(docs);
  writeFileSync(join(docs, "a.txt"), "a");
  renameSync(join(docs, "a.txt"), join(home, "a.txt"));
  stack.push(moveAction([{ from: join(docs, "a.txt"), to: join(home, "a.txt") }], env()));
  await stack.undo();
  expect(existsSync(join(docs, "a.txt"))).toBe(true);
  await stack.redo();
  expect(existsSync(join(home, "a.txt"))).toBe(true);
});

test("a copy's Undo sends it to the Trash", async () => {
  const stack = new UndoStack();
  const copy = join(home, "a copy.txt");
  writeFileSync(copy, "a");
  stack.push(copyAction("Duplicate", [copy], env()));
  expect(stack.state.undoName).toBe("Duplicate");
  await stack.undo();
  expect(existsSync(copy)).toBe(false);
  await stack.redo();
  expect(existsSync(copy)).toBe(true);
});
