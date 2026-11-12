import { expect, test } from "bun:test";
import type { WindowKeyInfo } from "@mirinjs/metal";
import { foldCrumbs } from "../apps/files/lib/omnibox/crumbs.tsx";
import { extensionLabel } from "../src/shared/file-browser/file-icon.tsx";
import { browserKey } from "../src/shared/file-browser/keys.ts";
import { CATEGORY_TINTS, DARK_INK, iconKind, iconMarkup, LIGHT_INK } from "../src/shared/file-browser/lib/file-icons.ts";
import { navigate } from "../src/shared/file-browser/lib/selection.ts";
import { DEFAULT_PREFS, parsePrefs } from "../src/shared/file-browser/prefs.ts";
import { looksLikeText } from "../src/shared/files/sniff.ts";

// The file browser Files and every chooser share: its keys, two-way arrows, icons, and memory.

const shown = ["a", "b", "c", "d", "e", "f", "g"];
const grid = { columns: 3, page: 2 };
const list = { columns: 1, page: 3 };

test("in a grid ← → move one place and ↑ ↓ a row; ↑ on the top row stays, ↓ into a short last row lands on its end", () => {
  expect(navigate(shown, ["b"], "b", "b", "right", grid, false)?.selection).toEqual(["c"]);
  expect(navigate(shown, ["b"], "b", "b", "left", grid, false)?.selection).toEqual(["a"]);
  expect(navigate(shown, ["b"], "b", "b", "down", grid, false)?.selection).toEqual(["e"]);
  expect(navigate(shown, ["e"], "e", "e", "up", grid, false)?.selection).toEqual(["b"]);
  expect(navigate(shown, ["b"], "b", "b", "up", grid, false)?.selection).toEqual(["b"]);
  // Row two (d e f) to the last row, which has only g.
  expect(navigate(shown, ["f"], "f", "f", "down", grid, false)?.selection).toEqual(["g"]);
  expect(navigate(shown, ["g"], "g", "g", "down", grid, false)?.selection).toEqual(["g"]);
});

test("a list has no ← →; Home, End and the page keys; nothing selected starts at an end", () => {
  expect(navigate(shown, ["b"], "b", "b", "right", list, false)).toBeNull();
  expect(navigate(shown, ["b"], "b", "b", "down", list, false)?.selection).toEqual(["c"]);
  expect(navigate(shown, ["c"], "c", "c", "home", list, false)?.selection).toEqual(["a"]);
  expect(navigate(shown, ["c"], "c", "c", "end", list, false)?.selection).toEqual(["g"]);
  expect(navigate(shown, ["a"], "a", "a", "page-down", list, false)?.selection).toEqual(["d"]);
  expect(navigate(shown, [], null, null, "down", list, false)?.selection).toEqual(["a"]);
  expect(navigate(shown, [], null, null, "up", list, false)?.selection).toEqual(["g"]);
  expect(navigate([], [], null, null, "down", list, false)).toBeNull();
});

test("⇧ with a move key selects the run from the anchor, and the keyboard goes on from the run's moving end", () => {
  const first = navigate(shown, ["b"], "b", "b", "right", grid, true);
  expect(first).toEqual({ selection: ["b", "c"], anchor: "b", focus: "c" });
  const second = navigate(shown, first?.selection ?? [], "b", first?.focus ?? null, "down", grid, true);
  expect(second).toEqual({ selection: ["b", "c", "d", "e", "f"], anchor: "b", focus: "f" });
  // Back past the anchor: the run turns round it.
  expect(navigate(shown, ["b", "c"], "b", "c", "home", grid, true)).toEqual({ selection: ["a", "b"], anchor: "b", focus: "a" });
});

const key = (name: string, extra: Partial<WindowKeyInfo> = {}): WindowKeyInfo => ({
  key: name,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  repeat: false,
  ...extra,
});

test("the browser's keys", () => {
  expect(browserKey(key("left"))).toEqual({ kind: "move", step: "left", extend: false });
  expect(browserKey(key("down", { shift: true }))).toEqual({ kind: "move", step: "down", extend: true });
  expect(browserKey(key("pagedown"))).toEqual({ kind: "move", step: "page-down", extend: false });
  expect(browserKey(key("enter"))).toEqual({ kind: "open" });
  expect(browserKey(key("f2"))).toEqual({ kind: "rename" });
  expect(browserKey(key("delete"))).toEqual({ kind: "trash" });
  expect(browserKey(key("space", { text: " " }))).toEqual({ kind: "peek" });
  expect(browserKey(key("escape"))).toEqual({ kind: "clear" });
  expect(browserKey(key("backspace"))).toEqual({ kind: "back" });
  // ❖↑ and ❖↓ reach a window as Ctrl+Home and Ctrl+End (keymap.ts).
  expect(browserKey(key("home", { ctrl: true }))).toEqual({ kind: "enclosing" });
  expect(browserKey(key("end", { ctrl: true }))).toEqual({ kind: "open" });
  expect(browserKey(key("r", { text: "r" }))).toEqual({ kind: "text", text: "r" });
  expect(browserKey(key("v", { ctrl: true, pasted: "file:///h/a.txt" }))).toEqual({ kind: "text", text: "file:///h/a.txt" });
  expect(browserKey(key("a", { ctrl: true }))).toBeNull();
  expect(browserKey(key("a", { meta: true, text: "a" }))).toBeNull();
});

test("text is told by its first bytes: UTF-8, no NUL, hardly any control characters", () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
  expect(looksLikeText(bytes("make: *** [all] Error 2\nbuild.done\n"))).toBe(true);
  expect(looksLikeText(bytes("ok — café, 日本語"))).toBe(true);
  // A character cut at the end of the sample still reads.
  expect(looksLikeText(bytes("日本").subarray(0, 4))).toBe(true);
  expect(looksLikeText(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x00]))).toBe(false);
  expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0x41, 0x42]))).toBe(false);
  expect(looksLikeText(new Uint8Array([1, 2, 3, 4, 5, 65]))).toBe(false);
  expect(looksLikeText(new Uint8Array())).toBe(false);
});

test("one icon recipe: a page with its category's glyph, a folder with a special folder's emblem, light and dark", () => {
  expect(iconKind({ kind: "file", mime: "image/png" })).toEqual({ folder: false, category: "image" });
  expect(iconKind({ kind: "file", mime: "application/octet-stream" })).toEqual({ folder: false, category: "other" });
  expect(iconKind({ kind: "folder", mime: "inode/directory" }, "downloads")).toEqual({ folder: true, emblem: "downloads" });
  const page = iconMarkup({ folder: false, category: "image" }, LIGHT_INK);
  expect(page).toContain(CATEGORY_TINTS.image);
  expect(page).toContain(LIGHT_INK.page[0]);
  expect(iconMarkup({ folder: false, category: "image" }, DARK_INK)).toContain(DARK_INK.page[0]);
  // An unknown type's page is blank: its extension is drawn on it as a label.
  expect(iconMarkup({ folder: false, category: "other" }, LIGHT_INK)).not.toContain("stroke-linecap");
  expect(iconMarkup({ folder: true, emblem: "documents" }, LIGHT_INK)).toContain(LIGHT_INK.emblem);
  expect(iconMarkup({ folder: true }, LIGHT_INK)).not.toContain(LIGHT_INK.emblem);
  expect(extensionLabel("install.err")).toBe("ERR");
  expect(extensionLabel("build.events")).toBe("EVENT");
  expect(extensionLabel("Makefile")).toBeNull();
});

test("the view, the sort and Show Hidden are kept; anything odd in the file is the default", () => {
  expect(parsePrefs('{"view":"list","sort":{"key":"modified","ascending":false},"showHidden":true}')).toEqual({
    view: "list",
    sort: { key: "modified", ascending: false },
    showHidden: true,
  });
  expect(parsePrefs('{"view":"tiles","sort":{"key":"../etc"}}')).toEqual(DEFAULT_PREFS);
  expect(parsePrefs("not json")).toEqual(DEFAULT_PREFS);
});

test("a deep path folds its first folders into “…”, keeping the first and the last three", () => {
  expect(foldCrumbs(["Home", "a", "b"]).map((each) => (each.folded ? "…" : each.segment))).toEqual(["Home", "a", "b"]);
  expect(foldCrumbs(["Home", "a", "b", "c", "d", "e"]).map((each) => (each.folded ? `…${each.segment}` : each.segment))).toEqual(["Home", "…b", "c", "d", "e"]);
});
