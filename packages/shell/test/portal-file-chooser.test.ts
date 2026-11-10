import { expect, test } from "bun:test";
import { chooserReply, parseChooser } from "../apps/portal/lib/file-chooser/options.ts";
import { encodeBytePath } from "../apps/portal/lib/vardict.ts";
import { type Variant, variant } from "../src/shared/dbus/index.ts";
import { startFolder, startName } from "../src/shared/files/chooser/accept.ts";
import { passes } from "../src/shared/files/chooser/filters.ts";

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
