import { expect, test } from "bun:test";
import { completions, displayPath, intentOf } from "../apps/files/lib/omnibox/omnibox.ts";
import { editText } from "../apps/files/lib/omnibox/omnibox.tsx";

const home = "/home/me";
const tree: Record<string, string[]> = {
  "/home/me": ["Developer", "Documents", "Downloads", ".config", "desk"],
  "/home/me/Developer": ["dashiOS", "mirin"],
  "/": ["usr", "home"],
};
const list = (dir: string) => tree[dir] ?? [];

test("a path goes, anything else searches", () => {
  expect(intentOf("/usr/share")).toBe("path");
  expect(intentOf("  ~/Documents")).toBe("path");
  expect(intentOf("file:///tmp")).toBe("path");
  expect(intentOf("report")).toBe("search");
  expect(intentOf("my ~ file")).toBe("search");
});

test("folders under home read with ~, and editing starts after a slash", () => {
  expect(displayPath("/home/me/Developer/dnd", home)).toBe("~/Developer/dnd");
  expect(displayPath("/home/me", home)).toBe("~");
  expect(displayPath("/home/meg", home)).toBe("/home/meg");
  expect(editText({ kind: "folder", path: "/home/me/Developer" }, home)).toBe("~/Developer/");
  expect(editText({ kind: "folder", path: "/" }, home)).toBe("/");
  expect(editText({ kind: "recents" }, home)).toBe("");
});

test("completions: the folder's subfolders by prefix, any case, hidden ones only when asked", () => {
  expect(completions("~/d", home, list)).toEqual(["~/desk/", "~/Developer/", "~/Documents/", "~/Downloads/"]);
  expect(completions("~/Developer/", home, list)).toEqual(["~/Developer/dashiOS/", "~/Developer/mirin/"]);
  expect(completions("~/.c", home, list)).toEqual(["~/.config/"]);
  expect(completions("~/", home, list)).not.toContain("~/.config/");
  expect(completions("/u", home, list)).toEqual(["/usr/"]);
  expect(completions("~", home, list)).toEqual([]);
  expect(completions("report", home, list)).toEqual([]);
});
