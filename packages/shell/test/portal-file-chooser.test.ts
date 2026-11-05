import { expect, test } from "bun:test";
import { accept, type Standing, startFolder, startName } from "../apps/portal/file-chooser/accept.ts";
import { filterExtension, freeName, globRegex, mimeMatches, nameProblem, passes, withExtension } from "../apps/portal/file-chooser/filters.ts";
import { ChooserModel, type Row, recentFolders, type Sources, visibleRows } from "../apps/portal/file-chooser/model.ts";
import { type ChooserRequest, chooserReply, parseChooser } from "../apps/portal/file-chooser/options.ts";
import { encodeBytePath } from "../apps/portal/vardict.ts";
import { type Variant, variant } from "../src/dbus/index.ts";

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

const row = (path: string, extra: Partial<Row> = {}): Row => ({
  path,
  name: path.split("/").pop() ?? "",
  folder: false,
  mime: "application/pdf",
  mtime: 0,
  hidden: false,
  ...extra,
});

test("rows: folders always, files by the filter, hidden ones never; recents newest first, folders by name", () => {
  const filter = { name: "PDF", patterns: [{ kind: "mime" as const, pattern: "application/pdf" }] };
  const rows = [
    row("/h/b.pdf", { mtime: 1 }),
    row("/h/a.pdf", { mtime: 2 }),
    row("/h/x.png", { mime: "image/png" }),
    row("/h/sub", { folder: true, mime: "inode/directory" }),
    row("/h/.secret.pdf", { hidden: true }),
  ];
  expect(visibleRows(rows, { directory: false }, filter, "folder").map((r) => r.name)).toEqual(["sub", "a.pdf", "b.pdf"]);
  expect(visibleRows(rows, { directory: false }, filter, "recents").map((r) => r.name)).toEqual(["a.pdf", "b.pdf", "sub"]);
  expect(visibleRows(rows, { directory: true }, filter, "folder").map((r) => r.name)).toEqual(["sub"]);
  expect(recentFolders([row("/h/Docs/a.pdf", { mtime: 5 }), row("/h/Docs/b.pdf"), row("/h/c.pdf")], "/h").map((r) => [r.path, r.where])).toEqual([
    ["/h/Docs", "~"],
  ]);
});

function fakeSources(): Sources & { searched: string[] } {
  const searched: string[] = [];
  return {
    home: "/h",
    searched,
    recents: async () => [row("/h/Docs/Lease.pdf", { mtime: 9, where: "~/Docs" })],
    search: async (query) => {
      searched.push(query);
      return [row("/h/Docs/Lease.pdf", { where: "~/Docs" })];
    },
    folder: async (path) => ({ rows: [row(`${path}/Lease.pdf`), row(`${path}/learning.pdf`), row(`${path}/other.pdf`)], error: null }),
  };
}

test("the model opens on Recents, searches from two letters, and picks", async () => {
  const sources = fakeSources();
  const model = new ChooserModel(request({}), sources, { folder: "/h/Docs", name: "" });
  await Bun.sleep(1);
  expect(model.getSnapshot().place).toEqual({ kind: "recents" });
  expect(model.visible().map((r) => r.name)).toEqual(["Lease.pdf"]);
  model.search("l");
  expect(sources.searched).toEqual([]);
  model.search("lea");
  await Bun.sleep(1);
  // LocalSearch's hit and the last folder's own names, each once.
  expect(model.visible().map((r) => r.path)).toEqual(["/h/Docs/Lease.pdf", "/h/Docs/learning.pdf"].sort((a, b) => a.localeCompare(b)));
  model.pick("/h/Docs/Lease.pdf");
  expect(model.picked()).toEqual([{ path: "/h/Docs/Lease.pdf", folder: false }]);
  model.search("");
  await Bun.sleep(1);
  expect(model.getSnapshot().place).toEqual({ kind: "recents" });
});

test("a save takes the name of the file picked; the step keys move the pick", async () => {
  const model = new ChooserModel(request({ mode: "save" }), fakeSources(), { folder: "/h/Docs", name: "Untitled.pdf" });
  await Bun.sleep(1);
  expect(model.getSnapshot().place).toEqual({ kind: "folder", path: "/h/Docs" });
  // By name, as people sort: "learning" before "Lease".
  model.step(1);
  expect(model.getSnapshot().selected).toEqual(["/h/Docs/learning.pdf"]);
  expect(model.getSnapshot().name).toBe("learning.pdf");
  model.step(1);
  expect(model.getSnapshot().selected).toEqual(["/h/Docs/Lease.pdf"]);
});
