import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accept, type Standing, startFolder, startName } from "../apps/files/chooser/accept.ts";
import { filterExtension, freeName, globRegex, mimeMatches, nameProblem, passes, withExtension } from "../apps/files/chooser/filters.ts";
import { ChooserModel, chooserShows, folderName, folderTrail } from "../apps/files/chooser/model.ts";
import type { Env } from "../apps/files/env.ts";
import type { FilesPrefs } from "../apps/files/prefs.ts";
import { type ChooserRequest, chooserReply, parseChooser } from "../apps/portal/file-chooser/options.ts";
import { encodeBytePath } from "../apps/portal/vardict.ts";
import { type Variant, variant } from "../src/shared/dbus/index.ts";

const pdfs: [string, Array<[number, string]>] = ["PDF documents", [[1, "application/pdf"]]];
const notes: [string, Array<[number, string]>] = [
  "Notes",
  [
    [0, "*.md"],
    [0, "*.txt"],
  ],
];

const options = (entries: Record<string, Variant>) => new Map(Object.entries(entries));

test("OpenFile's options: filters, the current filter, choices, folder mode, multiple", () => {
  const request = parseChooser("open", [
    "net.imput.helium",
    "wayland:abc",
    "Open Lease",
    options({
      accept_label: variant("s", "_Upload"),
      multiple: variant("b", true),
      filters: variant("a(sa(us))", [pdfs, notes, ["Broken", [[7, "x"]]]]),
      current_filter: variant("(sa(us))", notes),
      choices: variant("a(ssa(ss)s)", [
        [
          "encoding",
          "Encoding",
          [
            ["utf8", "UTF-8"],
            ["latin1", "Latin-1"],
          ],
          "latin1",
        ],
        ["readonly", "Open read-only", [], "true"],
        ["bad", "Bad", [["a", "A"]], "missing"],
      ]),
      current_folder: variant("ay", encodeBytePath("/home/alex/Documents")),
      directory: variant("s", "not a boolean"),
    }),
  ]);
  expect(request).toMatchObject({
    appId: "net.imput.helium",
    parent: "wayland:abc",
    title: "Open Lease",
    acceptLabel: "Upload",
    multiple: true,
    directory: false,
    currentFolder: "/home/alex/Documents",
  });
  expect(request.filters.map((filter) => filter.name)).toEqual(["PDF documents", "Notes"]);
  expect(request.currentFilter).toBe(request.filters[1] ?? null);
  expect(request.choices).toEqual([
    {
      id: "encoding",
      label: "Encoding",
      options: [
        { id: "utf8", label: "UTF-8" },
        { id: "latin1", label: "Latin-1" },
      ],
      initial: "latin1",
    },
    { id: "readonly", label: "Open read-only", options: [], initial: "true" },
    { id: "bad", label: "Bad", options: [{ id: "a", label: "A" }], initial: "a" },
  ]);
});

test("a current filter given alone joins the list; no filters lets everything through", () => {
  const alone = parseChooser("open", ["", "", "", options({ current_filter: variant("(sa(us))", ["Images", [[1, "image/*"]]]) })]);
  expect(alone.filters.map((filter) => filter.name)).toEqual(["Images"]);
  expect(alone.currentFilter?.name).toBe("Images");
  const none = parseChooser("open", ["", "", "", new Map()]);
  expect(none.title).toBe("Open");
  expect(none.currentFilter).toBeNull();
  expect(passes(none.currentFilter, "anything.bin", "application/octet-stream")).toBe(true);
});

test("SaveFile and SaveFiles: the name, the file saved again, the files' names", () => {
  const save = parseChooser("save", [
    "",
    "",
    "Save Image",
    options({ current_name: variant("s", "Untitled.png"), current_file: variant("ay", encodeBytePath("/home/alex/Pictures/cat.png")) }),
  ]);
  expect(startName(save)).toBe("Untitled.png");
  expect(startFolder(save, "/home/alex/Documents", "/home/alex")).toBe("/home/alex/Pictures");
  expect(save.multiple).toBe(false);
  const enc = new TextEncoder();
  const files = parseChooser("save-files", [
    "",
    "",
    "",
    options({ files: variant("aay", [encodeBytePath("a.txt"), enc.encode("../../etc/passwd\0"), encodeBytePath(".."), encodeBytePath("b.txt")]) }),
  ]);
  expect(files.files).toEqual(["a.txt", "passwd", "b.txt"]);
  expect(startFolder(parseChooser("save", ["", "", "", new Map()]), null, "/home/alex")).toBe("/home/alex");
});

test("the reply: file URIs, choices, the filter used; cancelled with nothing", () => {
  const [code, results] = chooserReply({
    paths: ["/home/alex/My Lease.pdf"],
    choices: [["encoding", "utf8"]],
    filter: { name: "PDF", patterns: [{ kind: "mime", pattern: "application/pdf" }] },
  });
  expect(code).toBe(0);
  expect((results.get("uris") as Variant).value).toEqual(["file:///home/alex/My%20Lease.pdf"]);
  expect((results.get("choices") as Variant).signature).toBe("a(ss)");
  expect((results.get("current_filter") as Variant).value).toEqual(["PDF", [[1, "application/pdf"]]]);
  expect(chooserReply(null)[0]).toBe(1);
  expect(chooserReply({ paths: [], choices: [], filter: null })[0]).toBe(1);
});

test("filters: globs ignore case, classes work, MIME families match", () => {
  expect(globRegex("*.pdf").test("Lease.PDF")).toBe(true);
  expect(globRegex("*.pdf").test("Lease.pdf.txt")).toBe(false);
  expect(globRegex("IMG_[0-9]???.jpg").test("img_1234.jpg")).toBe(true);
  expect(globRegex("a+b(1).txt").test("a+b(1).txt")).toBe(true);
  expect(mimeMatches("image/*", "image/png")).toBe(true);
  expect(mimeMatches("image/*", "video/mp4")).toBe(false);
  expect(mimeMatches("application/pdf", "Application/PDF")).toBe(true);
  const filter = {
    name: "Mixed",
    patterns: [
      { kind: "glob" as const, pattern: "*.md" },
      { kind: "mime" as const, pattern: "image/*" },
    ],
  };
  expect(passes(filter, "notes.md", "text/markdown")).toBe(true);
  expect(passes(filter, "cat.jpg", "image/jpeg")).toBe(true);
  expect(passes(filter, "song.mp3", "audio/mpeg")).toBe(false);
});

test("save names: problems, free names, the filter's extension", () => {
  expect(nameProblem("")).not.toBeNull();
  expect(nameProblem("a/b")).not.toBeNull();
  expect(nameProblem("..")).not.toBeNull();
  expect(nameProblem("Report.pdf")).toBeNull();
  const taken = new Set(["a.txt", "a 2.txt"]);
  expect(freeName("a.txt", (name) => taken.has(name))).toBe("a 3.txt");
  expect(freeName("README", (name) => name === "README")).toBe("README 2");
  expect(filterExtension({ name: "PNG", patterns: [{ kind: "glob", pattern: "*.png" }] })).toBe(".png");
  expect(filterExtension({ name: "Images", patterns: [{ kind: "mime", pattern: "image/*" }] })).toBeNull();
  expect(withExtension("cat.jpg", ".png")).toBe("cat.png");
  expect(withExtension("cat", ".png")).toBe("cat.png");
});

const request = (overrides: Partial<ChooserRequest>): ChooserRequest => ({ ...parseChooser("open", ["", "", "", new Map()]), ...overrides });
const standing = (overrides: Partial<Standing>): Standing => ({
  folder: "/h",
  saveFolder: "/h/Documents",
  selected: [],
  name: "",
  replacing: null,
  ...overrides,
});

test("Open: files picked, a folder gone into, folders in folder mode, the current folder when nothing is picked", () => {
  const nothing = () => false;
  expect(
    accept(
      request({}),
      standing({
        selected: [
          { path: "/h/a", folder: false },
          { path: "/h/b", folder: false },
        ],
      }),
      nothing,
    ),
  ).toEqual({ kind: "done", paths: ["/h/a"] });
  expect(
    accept(
      request({ multiple: true }),
      standing({
        selected: [
          { path: "/h/a", folder: false },
          { path: "/h/b", folder: false },
        ],
      }),
      nothing,
    ),
  ).toEqual({ kind: "done", paths: ["/h/a", "/h/b"] });
  expect(accept(request({}), standing({ selected: [{ path: "/h/sub", folder: true }] }), nothing)).toEqual({ kind: "open-folder", path: "/h/sub" });
  expect(accept(request({}), standing({}), nothing)).toEqual({ kind: "nothing" });
  expect(accept(request({ directory: true }), standing({ selected: [{ path: "/h/sub", folder: true }] }), nothing)).toEqual({
    kind: "done",
    paths: ["/h/sub"],
  });
  expect(accept(request({ directory: true }), standing({}), nothing)).toEqual({ kind: "done", paths: ["/h"] });
  expect(accept(request({ directory: true }), standing({ folder: null }), nothing)).toEqual({ kind: "nothing" });
});

test("Save: a bad name, a file that would be replaced (once asked, saved), a folder gone into", () => {
  const save = request({ mode: "save" });
  const exists = (path: string) => path === "/h/Lease.pdf";
  expect(accept(save, standing({ name: " " }), exists).kind).toBe("problem");
  expect(accept(save, standing({ name: "Lease.pdf" }), exists)).toEqual({ kind: "replace", path: "/h/Lease.pdf" });
  expect(accept(save, standing({ name: "Lease.pdf", replacing: "/h/Lease.pdf" }), exists)).toEqual({ kind: "done", paths: ["/h/Lease.pdf"] });
  expect(accept(save, standing({ name: "New.pdf", folder: null }), exists)).toEqual({ kind: "done", paths: ["/h/Documents/New.pdf"] });
  expect(accept(save, standing({ name: "New.pdf", selected: [{ path: "/h/sub", folder: true }] }), exists)).toEqual({ kind: "open-folder", path: "/h/sub" });
  const many = request({ mode: "save-files", files: ["a.txt", "a.txt", "b.txt"] });
  expect(accept(many, standing({}), (path) => path === "/h/b.txt")).toEqual({ kind: "done", paths: ["/h/a.txt", "/h/a 2.txt", "/h/b 2.txt"] });
});

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

function chooser(over: Partial<ChooserRequest>, recents: string[] = [], name = ""): ChooserModel {
  const model = new ChooserModel(request(over), env(recents), { folder: docs, name }, { prefs: PREFS, watch: false });
  model.start();
  return model;
}

test("what shows: folders always, files the filter lets by, no hidden ones; only folders when choosing folders", async () => {
  const model = chooser({ mode: "save", currentFilter: PDF, filters: [PDF] });
  await Bun.sleep(30);
  expect(names(model)).toEqual(["Taxes", "learning.pdf", "Lease.pdf"]);
  model.setFilter(null);
  expect(names(model)).toEqual(["Taxes", "learning.pdf", "Lease.pdf", "x.png"]);
  model.stop();
  expect(chooserShows({ directory: true }, null, { kind: "file", name: "a.pdf", mime: "application/pdf" })).toBe(false);
  expect(chooserShows({ directory: true }, null, { kind: "folder", name: "a", mime: "inode/directory" })).toBe(true);
});

test("Open starts on Recents; a double-click or Return on a file accepts", async () => {
  const lease = join(docs, "Lease.pdf");
  const model = chooser({}, [lease]);
  let accepted = 0;
  model.onAccept = () => accepted++;
  await Bun.sleep(30);
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
  const empty = chooser({});
  await Bun.sleep(30);
  expect(empty.store.getSnapshot().location).toEqual({ kind: "folder", path: home });
  expect(empty.store.getSnapshot().canBack).toBe(false);
  empty.stop();
  // A recent file the filter keeps out is as good as none.
  const filtered = chooser({ currentFilter: PDF, filters: [PDF] }, [join(docs, "x.png")]);
  await Bun.sleep(30);
  expect(filtered.folder()).toBe(home);
  filtered.stop();
  // (start.ts opens the chooser in the folder named: here, Documents.)
  const named = chooser({ currentFolder: docs }, [join(docs, "Lease.pdf")]);
  await Bun.sleep(30);
  expect(named.folder()).toBe(docs);
  named.stop();
});

test("a save takes the name of the file picked, asks before replacing, and makes a new folder that renames in place", async () => {
  const model = chooser({ mode: "save" }, [], "Untitled.pdf");
  await Bun.sleep(30);
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
  await Bun.sleep(30);
  expect(model.store.getSnapshot().renaming).toBe(join(docs, "untitled folder"));
  expect(await model.store.commitRename("Receipts")).toBe(true);
  await Bun.sleep(30);
  expect(names(model)).toContain("Receipts");
  model.stop();
});

test("Up goes to the folder this one is in; Back retraces the way", async () => {
  const model = chooser({ directory: true });
  await Bun.sleep(30);
  expect(model.folder()).toBe(docs);
  model.store.go({ kind: "folder", path: join(docs, "Taxes") });
  model.store.goUp();
  expect(model.folder()).toBe(docs);
  model.store.goBack();
  expect(model.folder()).toBe(join(docs, "Taxes"));
  // Nothing picked: choosing folders takes the one shown.
  await Bun.sleep(30);
  expect(model.decide(() => false)).toEqual({ kind: "done", paths: [join(docs, "Taxes")] });
  model.stop();
});

test("a folder holding only what the chooser keeps out says so, not that it is empty", async () => {
  // Choosing folders, in one with only files (and a hidden one).
  const files = join(docs, "Scans");
  mkdirSync(files);
  writeFileSync(join(files, "a.pdf"), "%PDF");
  const folders = chooser({ directory: true });
  folders.store.go({ kind: "folder", path: files });
  await Bun.sleep(30);
  expect(names(folders)).toEqual([]);
  expect(folders.store.keptOut()).toBe("No folders here");
  // Really empty: empty.
  folders.store.go({ kind: "folder", path: join(docs, "Taxes") });
  await Bun.sleep(30);
  expect(folders.store.keptOut()).toBeNull();
  folders.stop();
  // A filter that lets nothing here by.
  const pdfs = chooser({
    filters: [{ name: "PNG", patterns: [{ kind: "glob", pattern: "*.png" }] }],
    currentFilter: { name: "PNG", patterns: [{ kind: "glob", pattern: "*.png" }] },
  });
  pdfs.store.go({ kind: "folder", path: files });
  await Bun.sleep(30);
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
