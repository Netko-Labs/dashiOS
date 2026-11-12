import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enabledIds } from "../apps/kit/index.ts";
import { keyAction } from "../apps/preview/lib/keys.ts";
import { keptTurns, MAX_RECENTS, MemoryStore, memoryPath, parseMemory, withRecent, withTurns } from "../apps/preview/lib/memory.ts";
import { type PreviewMenuContext, previewMenus, recentLabels } from "../apps/preview/lib/menus.ts";
import { reservedBy } from "../src/app-menus/lib/reserved.ts";
import { chordFromShortcut } from "../src/app-menus/shortcut.ts";
import { until } from "./support/time.ts";

// What Preview remembers (memory.ts), its menus (menus.ts) and its bare keys (keys.ts).

const dir = mkdtempSync(join(tmpdir(), "dashi-preview-memory-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("what Preview remembers", () => {
  test("in the state folder, an empty variable counting as unset", () => {
    expect(memoryPath({ XDG_STATE_HOME: "/s" }, "/home/alexk")).toBe("/s/dashi/preview/memory.json");
    expect(memoryPath({ XDG_STATE_HOME: "" }, "/home/alexk")).toBe("/home/alexk/.local/state/dashi/preview/memory.json");
  });

  test("a recent file goes first, once; the list is kept short", () => {
    let memory = parseMemory("");
    for (let n = 0; n < 15; n++) memory = withRecent(memory, `/home/alexk/${n}.png`, n);
    memory = withRecent(memory, "/home/alexk/3.png", 99);
    expect(memory.recents).toHaveLength(MAX_RECENTS);
    expect(memory.recents[0]).toEqual({ path: "/home/alexk/3.png", openedMs: 99 });
    expect(memory.recents.filter((recent) => recent.path === "/home/alexk/3.png")).toHaveLength(1);
  });

  test("a rotation sticks while the file is as it was, and a full turn forgets it", () => {
    const file = { size: 10, mtimeMs: 1234.7 };
    let memory = withTurns(parseMemory("{}"), "/home/alexk/a.jpg", 5, file);
    expect(keptTurns(memory, "/home/alexk/a.jpg", file)).toBe(1);
    expect(keptTurns(memory, "/home/alexk/a.jpg", { ...file, size: 11 })).toBe(0);
    expect(keptTurns(memory, "/home/alexk/b.jpg", file)).toBe(0);
    memory = withTurns(memory, "/home/alexk/a.jpg", -4, file);
    expect(memory.turns).toEqual({});
  });

  test("what's odd in the file is left out", () => {
    const memory = parseMemory(
      JSON.stringify({
        recents: [{ path: "relative.png", openedMs: 1 }, { path: "/ok.png", openedMs: 2 }, { path: "/ok.png", openedMs: 3 }, null],
        turns: { "/a.png": { turns: 2, size: 1, mtimeMs: 1 }, "/b.png": { turns: 7, size: 1, mtimeMs: 1 }, rel: { turns: 1, size: 1, mtimeMs: 1 } },
      }),
    );
    expect(memory.recents).toEqual([{ path: "/ok.png", openedMs: 2 }]);
    expect(Object.keys(memory.turns)).toEqual(["/a.png"]);
    expect(parseMemory("[1,2]")).toEqual({ recents: [], turns: {} });
  });

  test("two windows writing keep each other's changes", () => {
    const file = join(dir, "state", "memory.json");
    const one = new MemoryStore(file, () => 1);
    const two = new MemoryStore(file, () => 2);
    one.opened("/home/alexk/one.pdf");
    two.opened("/home/alexk/two.png");
    two.rotated("/home/alexk/two.png", 1, { size: 5, mtimeMs: 5 });
    expect(one.recents().map((recent) => recent.path)).toEqual(["/home/alexk/two.png", "/home/alexk/one.pdf"]);
    expect(new MemoryStore(file).turnsFor("/home/alexk/two.png", { size: 5, mtimeMs: 5 })).toBe(1);
    expect(JSON.parse(readFileSync(file, "utf8")).turns["/home/alexk/two.png"].turns).toBe(1);
    writeFileSync(file, "not json");
    expect(new MemoryStore(file).recents()).toEqual([]);
    // No file at all: it remembers for this window only.
    const alone = new MemoryStore(null);
    alone.opened("/home/alexk/x.png");
    expect(alone.recents().map((recent) => recent.path)).toEqual(["/home/alexk/x.png"]);
  });

  test("a window hears what another opens, so its recent files list it too", async () => {
    // Review 20: fake.png, opened in a second window, never showed in the first one's Open Recent.
    const file = join(dir, "watched", "memory.json");
    const first = new MemoryStore(file);
    first.opened("/home/alexk/img1.jpg");
    let heard = 0;
    const stop = first.watch(() => heard++, 20);
    new MemoryStore(file).opened("/home/alexk/fake.png");
    await until(() => heard > 0, "the other window's change");
    stop();
    expect(heard).toBeGreaterThan(0);
    expect(first.recents().map((recent) => recent.path)).toEqual(["/home/alexk/fake.png", "/home/alexk/img1.jpg"]);
  });
});

const NOTHING = new Proxy({}, { get: () => () => {} }) as PreviewMenuContext["actions"];
const context = (patch: Partial<PreviewMenuContext> = {}): PreviewMenuContext => ({
  hasFile: true,
  hasPicture: true,
  isPdf: true,
  canTurn: true,
  canPrevious: true,
  canNext: true,
  canCopy: true,
  hasSelection: false,
  canExport: true,
  canPrint: true,
  sidebar: true,
  recents: [],
  blocked: false,
  actions: NOTHING,
  ...patch,
});

describe("Preview's menus", () => {
  test("no shortcut is one the keymap keeps for itself", () => {
    const { menus } = previewMenus(context({ recents: ["/home/alexk/a.png"] }));
    for (const menu of menus) {
      for (const row of menu.items) {
        if (!("shortcut" in row) || row.shortcut === undefined) continue;
        const chord = chordFromShortcut(row.shortcut);
        if (chord) expect([row.shortcut, reservedBy(chord)]).toEqual([row.shortcut, null]);
      }
    }
  });

  test("Open Recent lists the newest files under Open…, and opens the one chosen", () => {
    const opened: string[] = [];
    const recents = ["/home/alexk/b.pdf", "/home/alexk/Photos/a.png", "/home/alexk/Work/a.png", "/1", "/2", "/3", "/4"];
    const { menus, run } = previewMenus(context({ recents, actions: { ...NOTHING, openRecent: (path) => opened.push(path) } }));
    const file = menus.find((menu) => menu.id === "file");
    const labels = file?.items.flatMap((row) => ("label" in row && row.id.startsWith("recent-") ? [row.label] : []));
    expect(labels).toEqual(["b.pdf", "a.png — Photos", "a.png — Work", "1", "2"]);
    run("recent-1");
    expect(opened).toEqual(["/home/alexk/Photos/a.png"]);
    expect(enabledIds(menus).has("clear-recents")).toBeTrue();
  });

  test("a label never carries a control character, and is cut to fit", () => {
    expect(recentLabels(["/home/alexk/bad‮name.png", `/home/alexk/${"x".repeat(200)}.png`])).toEqual(["bad?name.png", `${"x".repeat(77)}…`]);
  });

  test("Copy needs something on screen; Select All a PDF; Zoom to Width is a PDF's", () => {
    let ids = enabledIds(previewMenus(context()).menus);
    for (const id of ["copy", "select-all", "fit-width", "export", "print", "rotate-left"]) expect(ids.has(id)).toBeTrue();
    ids = enabledIds(previewMenus(context({ isPdf: false })).menus);
    expect(ids.has("select-all")).toBeFalse();
    expect(ids.has("fit-width")).toBeFalse();
    ids = enabledIds(previewMenus(context({ blocked: true })).menus);
    expect([...ids]).toEqual([]);
  });
});

describe("the bare keys", () => {
  const key = (name: string, shift = false) => ({ key: name, ctrl: false, alt: false, meta: false, shift });
  test("in a PDF the arrows and page keys scroll, ← → page, Home and End go to the ends", () => {
    expect(keyAction(key("down"), true)).toEqual({ kind: "scroll", by: "line", direction: 1 });
    expect(keyAction(key("pageup"), true)).toEqual({ kind: "scroll", by: "screen", direction: -1 });
    expect(keyAction(key("space", true), true)).toEqual({ kind: "scroll", by: "screen", direction: -1 });
    expect(keyAction(key("right"), true)).toEqual({ kind: "step", direction: 1 });
    expect(keyAction(key("end"), true)).toEqual({ kind: "end", direction: 1 });
  });

  test("among pictures every arrow steps; letters do nothing; chords are the menus'", () => {
    expect(keyAction(key("up"), false)).toEqual({ kind: "step", direction: -1 });
    expect(keyAction(key("left"), false)).toEqual({ kind: "step", direction: -1 });
    expect(keyAction(key("f"), false)).toBeNull();
    expect(keyAction(key("0"), false)).toBeNull();
    expect(keyAction({ ...key("c"), meta: true }, true)).toBeNull();
    expect(keyAction(key("backspace"), false)).toEqual({ kind: "trash" });
  });
});
