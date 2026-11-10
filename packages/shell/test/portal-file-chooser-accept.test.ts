import { expect, test } from "bun:test";
import { accept, type Standing } from "../src/shared/files/chooser/accept.ts";
import { filterExtension, globRegex, mimeMatches, nameProblem, passes, untakenName, withExtension } from "../src/shared/files/chooser/filters.ts";
import { request } from "./support/portal-file-chooser.ts";

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
  expect(untakenName("a.txt", (name) => taken.has(name))).toBe("a 3.txt");
  expect(untakenName("README", (name) => name === "README")).toBe("README 2");
  expect(filterExtension({ name: "PNG", patterns: [{ kind: "glob", pattern: "*.png" }] })).toBe(".png");
  expect(filterExtension({ name: "Images", patterns: [{ kind: "mime", pattern: "image/*" }] })).toBeNull();
  expect(withExtension("cat.jpg", ".png")).toBe("cat.png");
  expect(withExtension("cat", ".png")).toBe("cat.png");
});

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
