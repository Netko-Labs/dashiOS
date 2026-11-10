import { describe, expect, test } from "bun:test";
import { calculate, type Entry } from "../src/entries.ts";
import { buildSections, filesStateFor, placeholderFor, selectable } from "../src/launcher/rows.ts";
import { app, file, list } from "./support/launcher-fixtures.ts";

const pane = (name: string): Entry => ({ id: `dev.dashi.settings/${name.toLowerCase()}`, name, icon: "/i.svg", glyph: "<svg/>", keywords: [], shell: true });

describe("math", () => {
  test('sums, precedence, percent, and "% of"', () => {
    expect(calculate("2+2")).toBe(4);
    expect(calculate("2+3*4")).toBe(14);
    expect(calculate("2^10")).toBe(1024);
    expect(calculate("15% of 80")).toBe(12);
    expect(calculate("50%")).toBe(0.5);
  });

  test("a number alone, a word, or a division by zero is not an answer", () => {
    expect(calculate("42")).toBeNull();
    expect(calculate("-5")).toBeNull();
    expect(calculate("firefox")).toBeNull();
    expect(calculate("1/0")).toBeNull();
    expect(calculate("of 80")).toBeNull();
  });
});

describe("rows", () => {
  test("a sum is the first row, and Enter copies it; copying says so in place", () => {
    const rows = selectable(buildSections(list({ query: "2+2", entries: [app("Terminal")] })));
    expect(rows[0]).toMatchObject({ id: "answer", title: "= 4", detail: "2+2", kind: "Answer", action: { kind: "copy", text: "4" } });
    const copied = selectable(buildSections(list({ query: "2+2", copied: { query: "2+2", ok: true } })));
    expect(copied[0]?.kind).toBe("Copied");
    const failed = selectable(buildSections(list({ query: "2+2", copied: { query: "2+2", ok: false } })));
    expect(failed[0]?.kind).toBe("Couldn't copy");
  });

  test("pure math never asks for files", () => {
    expect(filesStateFor({ query: "2+2", offered: true, off: false, answer: null, lastCount: 3 })).toEqual({ kind: "none" });
    expect(filesStateFor({ query: "t", offered: true, off: false, answer: null, lastCount: 3 })).toEqual({ kind: "none" });
    expect(filesStateFor({ query: "tea", offered: false, off: false, answer: null, lastCount: 3 })).toEqual({ kind: "none" });
  });

  test("file slots are held for the next answer, as many as the last one filled", () => {
    expect(filesStateFor({ query: "tea", offered: true, off: false, answer: { query: "te", files: [file("a")] }, lastCount: 2 })).toEqual({
      kind: "waiting",
      reserved: 2,
    });
    expect(filesStateFor({ query: "tea", offered: true, off: false, answer: { query: "tea", files: [file("a")] }, lastCount: 1 })).toMatchObject({
      kind: "found",
    });
    expect(filesStateFor({ query: "tea", offered: true, off: false, answer: { query: "tea", files: null }, lastCount: 0 })).toEqual({ kind: "off" });
    expect(filesStateFor({ query: "tea", offered: true, off: true, answer: null, lastCount: 0 })).toEqual({ kind: "off" });
  });

  test("files go below the instant rows, which are laid out from the query alone", () => {
    const entries = [app("Teams"), app("Tea")];
    const waiting = buildSections(list({ query: "tea", entries, files: { kind: "waiting", reserved: 2 } }));
    const found = buildSections(list({ query: "tea", entries, files: { kind: "found", files: [file("tea.md"), file("teapot.txt")] } }));
    expect(waiting.at(-1)).toMatchObject({ id: "files", rows: [], reserved: 2 });
    const instant = (sections: typeof found) => sections.filter((section) => section.id !== "files");
    expect(instant(found)).toEqual(instant(waiting));
    expect(found.at(-1)?.rows.map((row) => row.kind)).toEqual(["File", "File"]);
  });

  test("one kind is one untitled run; two kinds get Top hit, Apps and Settings heads", () => {
    expect(buildSections(list({ query: "te", entries: [app("Terminal"), app("Teams")] })).map((section) => section.title)).toEqual([undefined]);
    const mixed = buildSections(list({ query: "a", entries: [app("Applets"), pane("About"), pane("Agents"), app("Atlas")] }));
    expect(mixed.map((section) => section.title)).toEqual(["Top hit", "Apps", "Settings"]);
    expect(mixed[2]?.rows.every((row) => row.kind === "Settings" && "glyph" in row.icon)).toBe(true);
  });

  test("nothing found: Did you mean, Search files, Find in Software", () => {
    const entries = [app("Firefox"), app("Files", { id: "dev.dashi.files" }), app("Software", { id: "dev.dashi.software" })];
    const [nothing] = buildSections(list({ query: "fierfox", entries, files: { kind: "found", files: [] } }));
    expect(nothing?.title).toBe("Nothing called “fierfox”");
    expect(nothing?.rows.map((row) => row.title)).toEqual(["Did you mean Firefox?", "Search files for “fierfox”", "Find “fierfox” in Software"]);
  });

  test("while files are on their way and nothing else matched, nothing is said yet", () => {
    expect(buildSections(list({ query: "zzzz", entries: [app("Firefox")], files: { kind: "waiting", reserved: 0 } }))).toEqual([]);
  });

  test("file search off is a row, and the placeholder says what search can do", () => {
    const sections = buildSections(list({ query: "tea", entries: [app("Tea")], files: { kind: "off" } }));
    expect(sections.at(-1)?.rows[0]).toMatchObject({ id: "files-off", title: "File search is off", action: { kind: "search-files", query: "tea" } });
    expect(placeholderFor(true)).toBe("An app, a setting, a file, or a sum");
    expect(placeholderFor(false)).toBe("An app, a setting, or a sum");
  });

  test("empty: Recent then All apps; without history, examples that work here, then All apps", () => {
    const recent = buildSections(list({ recent: [app("Terminal")] }));
    expect(recent.map((section) => section.title)).toEqual(["Recent"]);
    expect(recent[0]?.rows.map((row) => row.id)).toEqual(["recent:app.terminal", "all-apps"]);
    const first = buildSections(list({ entries: [app("Files", { id: "dev.dashi.files" }), pane("Appearance")] }));
    expect(first[0]).toMatchObject({ title: "Try", aside: "Searches this computer only" });
    expect(first[0]?.rows.map((row) => row.id)).toEqual(["try:files", "try:15% of 80", "all-apps"]);
    const all = buildSections(list({ allApps: true, entries: [app("Zed"), app("Atlas"), pane("About"), app("Ghost", { hidden: true })] }));
    expect(all[0]?.rows.map((row) => row.title)).toEqual(["Atlas", "Zed"]);
  });

  test("an app that couldn't start is the first row, and Enter tries again", () => {
    const sections = buildSections(list({ query: "fire", entries: [app("Firefox")], failed: app("Firefox") }));
    expect(sections[0]?.rows[0]).toMatchObject({ id: "failed:app.firefox", title: "Couldn't open Firefox", action: { kind: "open" } });
  });
});
