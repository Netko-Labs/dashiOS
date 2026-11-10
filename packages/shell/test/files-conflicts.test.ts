import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sideLines } from "../apps/files/conflict-sheet.tsx";
import type { Env } from "../apps/files/env.ts";
import { folderAt } from "../apps/files/location.ts";
import { type Conflict, Operations, type Resolution } from "../apps/files/operations.ts";
import { FilesStore } from "../apps/files/store.ts";
import type { Exec } from "../src/shared/files/exec.ts";

// PA-3: a copy or a move onto a taken name asks (Replace, Keep Both, Skip, for all), and Undo takes a Replace back.
// New Folder takes a free name and renames in place.

let root = "";
let home = "";
let trash = { files: "", info: "" };
let seq = 0;

/** `gio trash` as the Trash specification has it, a new name for each so two of one name can sit there. */
const fakeGio: Exec = async (command) => {
  const path = command.at(-1) as string;
  const name = `${path.split("/").at(-1)}.${++seq}`;
  renameSync(path, join(trash.files, name));
  writeFileSync(join(trash.info, `${name}.trashinfo`), `[Trash Info]\nPath=${encodeURI(path)}\nDeletionDate=2026-11-06T02:00:00\n`);
  return { ok: true, code: 0, stdout: "", stderr: "" };
};

function files(): { store: FilesStore; ops: Operations; from: string; to: string } {
  const from = join(home, "From");
  const to = join(home, "To");
  mkdirSync(from, { recursive: true });
  mkdirSync(to, { recursive: true });
  const env = {
    home,
    user: "alexk",
    mime: { extensions: new Map(), literals: new Map() },
    run: fakeGio,
    trash,
    dirs: [],
    now: Date.now,
    recents: async () => [],
  } as unknown as Env;
  const store = new FilesStore(env, folderAt(to), { watch: false, noticeFadeMs: 20 });
  return { store, ops: new Operations(store), from, to };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "files-conflicts-"));
  home = join(root, "home");
  trash = { files: join(root, "trash", "files"), info: join(root, "trash", "info") };
  for (const dir of [home, trash.files, trash.info]) mkdirSync(dir, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const settle = (ms = 40): Promise<void> => new Promise((done) => setTimeout(done, ms));

test("a collision asks; Replace sends the one there to the Trash, and Undo brings it back", async () => {
  const { store, ops, from, to } = files();
  writeFileSync(join(from, "report.txt"), "newer");
  writeFileSync(join(to, "report.txt"), "older");
  const asked: Conflict[] = [];
  ops.ask = async (conflict) => {
    asked.push(conflict);
    return { resolution: "replace", all: false };
  };
  await ops.transfer([join(from, "report.txt")], to, "copy");
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ mode: "copy", dest: to, remaining: 0, existing: { path: join(to, "report.txt"), folder: false, size: 5 } });
  expect(readFileSync(join(to, "report.txt"), "utf8")).toBe("newer");
  expect(readdirSync(to)).toEqual(["report.txt"]);
  expect(store.getSnapshot().notice?.text).toBe("Copied “report.txt”, replacing 1 item.");
  await ops.undoStep("undo");
  expect(readFileSync(join(to, "report.txt"), "utf8")).toBe("older");
  expect(readdirSync(to)).toEqual(["report.txt"]);
  // Redo replaces it again: the copy comes back from the Trash, not the one it replaced.
  await ops.undoStep("redo");
  expect(readFileSync(join(to, "report.txt"), "utf8")).toBe("newer");
  await ops.undoStep("undo");
  expect(readFileSync(join(to, "report.txt"), "utf8")).toBe("older");
  store.stop();
});

test("Keep Both makes “name 2”; Skip leaves both where they are", async () => {
  const { store, ops, from, to } = files();
  writeFileSync(join(from, "a.txt"), "new");
  writeFileSync(join(to, "a.txt"), "old");
  let answer: Resolution = "keep-both";
  ops.ask = async () => ({ resolution: answer, all: false });
  await ops.transfer([join(from, "a.txt")], to, "copy");
  expect(readdirSync(to).sort()).toEqual(["a 2.txt", "a.txt"]);
  answer = "skip";
  await ops.transfer([join(from, "a.txt")], to, "move");
  expect(existsSync(join(from, "a.txt"))).toBe(true);
  expect(readFileSync(join(to, "a.txt"), "utf8")).toBe("old");
  expect(store.getSnapshot().notice?.text).toBe("Skipped “a.txt”.");
  store.stop();
});

test("an answer for all stands for the rest of the copy; nothing taken is never asked about", async () => {
  const { store, ops, from, to } = files();
  for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) writeFileSync(join(from, name), "new");
  for (const name of ["a.txt", "b.txt", "c.txt"]) writeFileSync(join(to, name), "old");
  const asked: number[] = [];
  ops.ask = async (conflict) => {
    asked.push(conflict.remaining);
    return { resolution: "skip", all: true };
  };
  await ops.transfer(
    ["a.txt", "b.txt", "c.txt", "d.txt"].map((name) => join(from, name)),
    to,
    "copy",
  );
  expect(asked).toEqual([3]);
  expect(readdirSync(to).sort()).toEqual(["a.txt", "b.txt", "c.txt", "d.txt"]);
  expect(readFileSync(join(to, "d.txt"), "utf8")).toBe("new");
  expect(readFileSync(join(to, "a.txt"), "utf8")).toBe("old");
  // A copy into its own folder never asks: it is a copy beside it.
  asked.length = 0;
  await ops.transfer([join(to, "d.txt")], to, "copy");
  expect(asked).toEqual([]);
  expect(readdirSync(to)).toContain("d 2.txt");
  store.stop();
});

test("New Folder takes the first free “untitled folder”, renames in place, and both steps undo", async () => {
  const { store, ops, to } = files();
  mkdirSync(join(to, "untitled folder"));
  store.start();
  await settle();
  const made = await ops.newFolder();
  expect(made).toEqual({ path: join(to, "untitled folder 2") });
  expect(store.getSnapshot().renaming).toBe(join(to, "untitled folder 2"));
  store.draftRename("Receipts");
  // A click elsewhere commits what was typed.
  store.clickEmpty();
  await settle();
  expect(existsSync(join(to, "Receipts"))).toBe(true);
  expect(store.getSnapshot().renaming).toBeNull();
  expect(ops.undo.state.undoName).toBe("Rename");
  await ops.undoStep("undo");
  expect(existsSync(join(to, "untitled folder 2"))).toBe(true);
  await ops.undoStep("undo");
  expect(existsSync(join(to, "untitled folder 2"))).toBe(false);
  store.stop();
});

test("a rename that can't be done keeps the field and says why; Esc keeps the name", async () => {
  const { store, ops, to } = files();
  writeFileSync(join(to, "a.txt"), "a");
  writeFileSync(join(to, "b.txt"), "b");
  store.start();
  await settle();
  store.startRename(join(to, "a.txt"));
  expect(await store.commitRename("b.txt")).toBe(false);
  expect(store.getSnapshot().renaming).toBe(join(to, "a.txt"));
  expect(store.getSnapshot().notice?.text).toBe("An item named “b.txt” already exists here.");
  store.endRename();
  expect(store.getSnapshot().renaming).toBeNull();
  expect(readdirSync(to).sort()).toEqual(["a.txt", "b.txt"]);
  expect(ops.undo.state.canUndo).toBe(false);
  store.stop();
});

test("while a new folder lists, the last one's items stay up (stale), then the new ones replace them", async () => {
  const { store, from, to } = files();
  writeFileSync(join(to, "here.txt"), "");
  writeFileSync(join(from, "there.txt"), "");
  store.start();
  await settle();
  expect(store.visible().map((item) => item.name)).toEqual(["here.txt"]);
  store.go(folderAt(from));
  expect(store.stale).toBe(true);
  expect(store.visible().map((item) => item.name)).toEqual(["here.txt"]);
  await settle();
  expect(store.stale).toBe(false);
  expect(store.visible().map((item) => item.name)).toEqual(["there.txt"]);
  store.stop();
});

test("a side's date has a line of its own, so it is never cut", () => {
  const today = new Date();
  today.setHours(0, 13, 0, 0);
  const lines = sideLines("There now", { folder: false, size: 6, mtime: today.getTime() });
  expect(lines.caption).toBe("There now · 6 bytes");
  expect(lines.date).toMatch(/^Today at 12:13/);
  expect(sideLines("Copying", { folder: true, size: 0, mtime: today.getTime() }).caption).toBe("Copying · Folder");
});
