import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandActions } from "../src/actions/sources/commands.ts";
import type { Entry } from "../src/entries.ts";
import { calculate } from "../src/entries.ts";
import { FileSearch, RETRY_MS } from "../src/file-search.ts";
import { KEYMAP } from "../src/keymap.ts";
import { AppIndex, nearestExisting } from "../src/launcher/app-index.ts";
import { failureNotice, LaunchFailures, RETRY } from "../src/launcher/failures.ts";
import { launcherIndex } from "../src/launcher/items.ts";
import { LAUNCHER_RULES, LauncherKeys, withLauncher } from "../src/launcher/keys.ts";
import { buildSections, type FileRow, filesStateFor, found, type ListInput, placeholderFor, selectable } from "../src/launcher/rows.ts";
import { keepInView, moveSelection, resolveSelection } from "../src/launcher/selection.ts";
import { NotificationStore } from "../src/notifications/store.ts";
import { parseRecents, RecentApps, recentEntries, remember } from "../src/recents.ts";

const app = (name: string, extra: Partial<Entry> = {}): Entry => ({ id: `app.${name.toLowerCase()}`, name, icon: "/i.svg", keywords: [], ...extra });
const pane = (name: string): Entry => ({ id: `dev.dashi.settings/${name.toLowerCase()}`, name, icon: "/i.svg", glyph: "<svg/>", keywords: [], shell: true });
const file = (name: string): FileRow => ({ url: `file:///home/alexk/${name}`, path: `/home/alexk/${name}`, name, folder: "~", mime: null, icon: "/f.svg" });
const ICONS = { calculator: "/calc.svg", files: "/files.svg", software: "/software.svg" };
const list = (input: Partial<ListInput>): ListInput => ({ query: "", entries: [], recent: [], files: { kind: "none" }, icons: ICONS, ...input });

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

describe("selection by id", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];

  test("held while listed, else the first row", () => {
    expect(resolveSelection(ids, "c")).toBe("c");
    expect(resolveSelection(ids, "gone")).toBe("a");
    expect(resolveSelection([], "a")).toBeNull();
    // Rows arriving below don't move it; rows above don't either: it's an id.
    expect(resolveSelection(["new", ...ids, "late"], "c")).toBe("c");
  });

  test("↑ ↓ wrap; pages stop at the ends; first and last", () => {
    expect(moveSelection(ids, "g", "down")).toBe("a");
    expect(moveSelection(ids, "a", "up")).toBe("g");
    expect(moveSelection(ids, "b", "page-down", 5)).toBe("g");
    expect(moveSelection(ids, "f", "page-down", 5)).toBe("g");
    expect(moveSelection(ids, "c", "page-up", 5)).toBe("a");
    expect(moveSelection(ids, "c", "first")).toBe("a");
    expect(moveSelection(ids, "c", "last")).toBe("g");
    expect(moveSelection([], null, "down")).toBeNull();
  });

  test("a long list scrolls just enough to keep the selection drawn", () => {
    expect(keepInView(0, 0, 8, 20)).toBe(0);
    expect(keepInView(8, 0, 8, 20)).toBe(1);
    expect(keepInView(19, 0, 8, 20)).toBe(12);
    expect(keepInView(3, 10, 8, 20)).toBe(3);
    expect(keepInView(5, 3, 8, 6)).toBe(0);
  });
});

describe("did you mean", () => {
  test("the ranking's typos, from four letters, only when nothing else matched", () => {
    const entries = [app("Firefox"), app("Terminal"), app("Hidden", { hidden: true })];
    const suggestion = (query: string) => found(list({ query, entries }), 5).suggestion?.entry?.name ?? null;
    expect(suggestion("fierfox")).toBe("Firefox");
    // Letters in order from a word start are a match of their own, not a typo.
    expect(found(list({ query: "termnal", entries }), 5).items.map((item) => item.entry?.name)).toEqual(["Terminal"]);
    expect(suggestion("fir")).toBeNull();
    expect(suggestion("hiden")).toBeNull();
    // A typo is never a result of its own.
    expect(found(list({ query: "fierfox", entries }), 5).items).toEqual([]);
  });

  test("only a single word that looks like a misspelt name: never a sentence on its way, nor a keyword one letter off", () => {
    const index = launcherIndex({
      entries: [app("Firefox", { keywords: ["browser"] })],
      actions: commandActions(async () => {}, KEYMAP),
    });
    const suggested = (query: string) => {
      const item = found(list({ query, index }), 5).suggestion;
      return item?.entry?.name ?? item?.action?.title ?? null;
    };
    // The VM run: "turn on" (Shut Down's "turn off", one letter off) asked "Did you mean Shut Down…?".
    expect(suggested("turn on")).toBeNull();
    expect(suggested("turn on the wifi")).toBeNull();
    expect(suggested("brwoser")).toBeNull();
    expect(suggested("fierfox")).toBe("Firefox");
    expect(suggested("restrat")).toBe("Restart…");
    const titles = buildSections(list({ query: "turn on", index, entries: [app("Files", { id: "dev.dashi.files" })] }))
      .flatMap((section) => section.rows)
      .map((row) => row.title);
    expect(titles.some((title) => title.startsWith("Did you mean"))).toBe(false);
  });
});

describe("recents", () => {
  test("parse, remember and list as before", () => {
    expect(parseRecents('{"recent":["a","b","a"]}')).toEqual(["a", "b"]);
    expect(parseRecents("not json")).toEqual([]);
    expect(remember(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(recentEntries([app("A", { id: "a" }), app("B", { id: "b" })], ["b", "gone", "a"]).map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  test("held in memory: read once, then every launch is remembered without reading the file again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashi-recents-"));
    const path = join(dir, "dashi", "recents.json");
    const writes: string[][] = [];
    const recents = new RecentApps(path, async (_path, ids) => {
      writes.push([...ids]);
    });
    expect(recents.list()).toEqual([]);
    recents.remember("terminal");
    recents.remember("files");
    expect(recents.list()).toEqual(["files", "terminal"]);
    await recents.settled();
    expect(writes).toEqual([["terminal"], ["files", "terminal"]]);
  });

  test("an app that quit as soon as it started is forgotten, and the file follows", async () => {
    const writes: string[][] = [];
    const recents = new RecentApps(join(tmpdir(), "unused.json"), async (_path, ids) => {
      writes.push([...ids]);
    });
    recents.remember("terminal");
    recents.remember("quits-demo");
    expect(recents.forget("quits-demo")).toEqual(["terminal"]);
    recents.forget("not-there");
    await recents.settled();
    expect(writes).toEqual([["terminal"], ["quits-demo", "terminal"], ["terminal"]]);
  });

  test("the file is written 0600, atomically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashi-recents-"));
    const path = join(dir, "dashi", "recents.json");
    const recents = new RecentApps(path);
    recents.remember("terminal");
    await recents.settled();
    expect(parseRecents(readFileSync(path, "utf8"))).toEqual(["terminal"]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(new RecentApps(path).list()).toEqual(["terminal"]);
  });
});

describe("the app index", () => {
  function fakes() {
    let loads = 0;
    const watched: Array<{ path: string; fire: () => void; closed: boolean }> = [];
    const timers: Array<() => void> = [];
    const index = new AppIndex({
      load: () => {
        loads += 1;
        return [app(`Load${loads}`)];
      },
      dirs: () => ["/home/alexk/.local/share/applications", "/usr/share/applications"],
      exists: (path) => path !== "/home/alexk/.local/share/applications",
      watch: (path, fire) => {
        const watcher = { path, fire, closed: false };
        watched.push(watcher);
        return { close: () => (watcher.closed = true) };
      },
      schedule: (run) => {
        timers.push(run);
        return () => {
          const at = timers.indexOf(run);
          if (at >= 0) timers.splice(at, 1);
        };
      },
    });
    const runTimers = () => {
      for (const run of timers.splice(0)) run();
    };
    return { index, watched, runTimers, loads: () => loads };
  }

  test("built once in the background; a tap reads memory", () => {
    const { index, runTimers, loads } = fakes();
    index.start();
    expect(index.isReady()).toBe(false);
    runTimers();
    expect(index.entries().map((entry) => entry.name)).toEqual(["Load1"]);
    index.entries();
    index.entries();
    expect(loads()).toBe(1);
  });

  test("an applications directory changing rebuilds it once per burst; a missing one is watched through its parent", () => {
    const { index, watched, runTimers, loads } = fakes();
    index.start();
    runTimers();
    const open = () => watched.filter((each) => !each.closed);
    expect(
      open()
        .map((each) => each.path)
        .sort(),
    ).toEqual(["/home/alexk/.local/share", "/usr/share/applications"]);
    const system = open().find((each) => each.path === "/usr/share/applications");
    system?.fire();
    system?.fire();
    system?.fire();
    runTimers();
    expect(loads()).toBe(2);
    expect(index.entries()[0]?.name).toBe("Load2");
    index.stop();
    expect(watched.every((each) => each.closed)).toBe(true);
  });

  test("the nearest folder that exists", () => {
    const exists = (path: string) => ["/", "/home", "/home/alexk"].includes(path);
    expect(nearestExisting("/home/alexk/.local/share/applications", exists)).toBe("/home/alexk");
  });
});

describe("keys while the launcher is open", () => {
  test("its rules come first and go with it", () => {
    const keymap = withLauncher(KEYMAP);
    expect(keymap.rules.slice(0, LAUNCHER_RULES.length)).toEqual(LAUNCHER_RULES);
    expect(keymap.rules.slice(LAUNCHER_RULES.length)).toEqual(KEYMAP.rules);
    expect(LAUNCHER_RULES.map((rule) => rule.when)).toEqual(expect.arrayContaining(["ctrl+n", "ctrl+p", "Home", "End"]));
  });

  test("bindings move the open launcher's selection; others are not its", () => {
    const keys = new LauncherKeys();
    const moves: string[] = [];
    const stop = keys.subscribe((move) => moves.push(move));
    expect(keys.binding("launcher-page-down")).toBe(true);
    expect(keys.binding("launcher-up")).toBe(true);
    expect(keys.binding("quit-app")).toBe(false);
    stop();
    keys.binding("launcher-down");
    expect(moves).toEqual(["page-down", "up"]);
  });
});

describe("failures", () => {
  test("an app that quits as it starts is a notification with Try again", () => {
    const notice = failureNotice("Firefox");
    expect(notice).toMatchObject({ summary: "Couldn't open Firefox", actions: [{ key: RETRY, label: "Try again" }] });
    const store = new NotificationStore();
    const failures = new LaunchFailures(store);
    let retried = 0;
    const id = failures.quit("Firefox", () => (retried += 1));
    expect(store.getSnapshot().live.map((each) => each.summary)).toEqual(["Couldn't open Firefox"]);
    // Try again runs once; the notice closes with it, and a late second press does nothing.
    expect(store.invoke(id, RETRY)).toBe(true);
    expect(store.invoke(id, RETRY)).toBe(false);
    expect(retried).toBe(1);
    failures.close();
  });

  test("file search: off without LocalSearch; off for a while after it fails to answer", async () => {
    expect(new FileSearch({ ask: async () => [], installed: false }).isAvailable()).toBe(false);
    let now = 0;
    let answer: FileRow[] | null = null;
    const search = new FileSearch({ ask: async () => answer, installed: true, now: () => now });
    expect(search.isAvailable()).toBe(true);
    expect(await search.find("tea")).toBeNull();
    expect(search.isAvailable()).toBe(false);
    now = RETRY_MS;
    answer = [file("tea.md")];
    expect(search.isAvailable()).toBe(true);
    expect((await search.find("tea"))?.map((hit) => hit.name)).toEqual(["tea.md"]);
  });
});
