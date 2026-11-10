import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChooserModel, chooserShows, folderName, folderTrail } from "../apps/files/chooser/model.ts";
import type { Env } from "../apps/files/env.ts";
import type { FilesPrefs } from "../apps/files/lib/prefs.ts";
import type { ChooserRequest } from "../src/shared/files/index.ts";
import { request } from "./support/portal-file-chooser.ts";
import { until } from "./support/time.ts";

// The model on Files' own browser, over real folders in a scratch home.

let root = "";
let home = "";
let docs = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chooser-"));
  home = join(root, "h");
  docs = join(home, "Docs");
  mkdirSync(join(docs, "Taxes"), { recursive: true });
  for (const name of ["Lease.pdf", "learning.pdf", "x.png", ".secret.pdf"]) writeFileSync(join(docs, name), "%PDF");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const PDF = { name: "PDF", patterns: [{ kind: "glob" as const, pattern: "*.pdf" }] };

function env(recents: string[] = []): Env {
  return {
    home,
    user: "alexk",
    mime: {
      extensions: new Map([
        ["pdf", "application/pdf"],
        ["png", "image/png"],
      ]),
      literals: new Map(),
    },
    run: async () => ({ ok: false, code: 1, stdout: "", stderr: "" }),
    trash: { files: join(root, "trash/files"), info: join(root, "trash/info") },
    cache: join(root, "cache"),
    dirs: [{ name: "DOCUMENTS", path: docs }],
    now: Date.now,
    recents: async () => recents.map((path) => ({ path, time: 1 })),
  } as unknown as Env;
}

const PREFS: FilesPrefs = { view: "list", sort: { key: "name", ascending: true }, showHidden: false };
const names = (model: ChooserModel): string[] => model.store.visible().map((item) => item.name);

async function chooser(over: Partial<ChooserRequest>, recents: string[] = [], name = ""): Promise<ChooserModel> {
  const model = new ChooserModel(request(over), env(recents), { folder: docs, name }, { prefs: PREFS, watch: false });
  model.start();
  await until(() => !model.store.getSnapshot().loading, "the folder to list");
  return model;
}

test("what shows: folders always, files the filter lets by, no hidden ones; only folders when choosing folders", async () => {
  const model = await chooser({ mode: "save", currentFilter: PDF, filters: [PDF] });
  expect(names(model)).toEqual(["Taxes", "learning.pdf", "Lease.pdf"]);
  model.setFilter(null);
  expect(names(model)).toEqual(["Taxes", "learning.pdf", "Lease.pdf", "x.png"]);
  model.stop();
  expect(chooserShows({ directory: true }, null, { kind: "file", name: "a.pdf", mime: "application/pdf" })).toBe(false);
  expect(chooserShows({ directory: true }, null, { kind: "folder", name: "a", mime: "inode/directory" })).toBe(true);
});

test("Open starts on Recents; a double-click or Return on a file accepts", async () => {
  const lease = join(docs, "Lease.pdf");
  const model = await chooser({}, [lease]);
  let accepted = 0;
  model.onAccept = () => accepted++;
  expect(model.store.getSnapshot().location).toEqual({ kind: "recents" });
  expect(names(model)).toEqual(["Lease.pdf"]);
  model.store.move("down");
  expect(model.selected()).toEqual([{ path: lease, folder: false }]);
  model.store.openSelection();
  expect(accepted).toBe(1);
  expect(model.decide(() => false)).toEqual({ kind: "done", paths: [lease] });
  model.stop();
});

test("Open with nothing in Recents for it opens Home; a folder the asker names opens there", async () => {
  const empty = await chooser({});
  expect(empty.store.getSnapshot().location).toEqual({ kind: "folder", path: home });
  expect(empty.store.getSnapshot().canBack).toBe(false);
  empty.stop();
  // A recent file the filter keeps out is as good as none.
  const filtered = await chooser({ currentFilter: PDF, filters: [PDF] }, [join(docs, "x.png")]);
  expect(filtered.folder()).toBe(home);
  filtered.stop();
  // (start.ts opens the chooser in the folder named: here, Documents.)
  const named = await chooser({ currentFolder: docs }, [join(docs, "Lease.pdf")]);
  expect(named.folder()).toBe(docs);
  named.stop();
});

test("a save takes the name of the file picked, asks before replacing, and makes a new folder that renames in place", async () => {
  const model = await chooser({ mode: "save" }, [], "Untitled.pdf");
  expect(model.folder()).toBe(docs);
  // By name, as people sort: "learning" before "Lease"; the folder first.
  model.store.move("down");
  model.store.move("down");
  expect(model.getSnapshot().name).toBe("learning.pdf");
  model.setName("Lease.pdf");
  const exists = (path: string): boolean => path === join(docs, "Lease.pdf");
  expect(model.decide(exists)).toEqual({ kind: "replace", path: join(docs, "Lease.pdf") });
  expect(model.getSnapshot().replace).toBe(join(docs, "Lease.pdf"));
  model.confirmReplace();
  expect(model.decide(exists)).toEqual({ kind: "done", paths: [join(docs, "Lease.pdf")] });

  expect(model.canMakeFolder()).toBe(true);
  await model.newFolder();
  await until(() => model.store.getSnapshot().renaming !== null, "the new folder's name field");
  expect(model.store.getSnapshot().renaming).toBe(join(docs, "untitled folder"));
  expect(await model.store.commitRename("Receipts")).toBe(true);
  await until(() => names(model).includes("Receipts"), "the new folder to list");
  expect(names(model)).toContain("Receipts");
  model.stop();
});

test("Up goes to the folder this one is in; Back retraces the way", async () => {
  const model = await chooser({ directory: true });
  expect(model.folder()).toBe(docs);
  model.store.go({ kind: "folder", path: join(docs, "Taxes") });
  model.store.goUp();
  expect(model.folder()).toBe(docs);
  model.store.goBack();
  expect(model.folder()).toBe(join(docs, "Taxes"));
  // Nothing picked: choosing folders takes the one shown.
  await until(() => !model.store.getSnapshot().loading, "the folder to list");
  expect(model.decide(() => false)).toEqual({ kind: "done", paths: [join(docs, "Taxes")] });
  model.stop();
});

test("a folder holding only what the chooser keeps out says so, not that it is empty", async () => {
  // Choosing folders, in one with only files (and a hidden one).
  const files = join(docs, "Scans");
  mkdirSync(files);
  writeFileSync(join(files, "a.pdf"), "%PDF");
  const folders = await chooser({ directory: true });
  folders.store.go({ kind: "folder", path: files });
  await until(() => !folders.store.getSnapshot().loading, "the folder to list");
  expect(names(folders)).toEqual([]);
  expect(folders.store.keptOut()).toBe("No folders here");
  // Really empty: empty.
  folders.store.go({ kind: "folder", path: join(docs, "Taxes") });
  await until(() => !folders.store.getSnapshot().loading, "the folder to list");
  expect(folders.store.keptOut()).toBeNull();
  folders.stop();
  // A filter that lets nothing here by.
  const pdfs = await chooser({
    filters: [{ name: "PNG", patterns: [{ kind: "glob", pattern: "*.png" }] }],
    currentFilter: { name: "PNG", patterns: [{ kind: "glob", pattern: "*.png" }] },
  });
  pdfs.store.go({ kind: "folder", path: files });
  await until(() => !pdfs.store.getSnapshot().loading, "the folder to list");
  expect(pdfs.store.keptOut()).toBe("No files of this kind here");
  pdfs.stop();
});

test("the folder pop-up lists the folder and each one it is in, named as people know them", () => {
  expect(folderTrail("/home/alexk/Documents/Taxes", "/home/alexk")).toEqual([
    { name: "Taxes", path: "/home/alexk/Documents/Taxes" },
    { name: "Documents", path: "/home/alexk/Documents" },
    { name: "Home", path: "/home/alexk" },
    { name: "home", path: "/home" },
    { name: "Computer", path: "/" },
  ]);
  expect(folderTrail("/", "/home/alexk")).toEqual([{ name: "Computer", path: "/" }]);
  expect(folderName("/media/alexk/USB", "/home/alexk")).toBe("USB");
});
