import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppIndex, nearestExisting } from "../src/launcher/app-index.ts";
import { failureNotice, LaunchFailures, RETRY } from "../src/launcher/failures.ts";
import type { FileRow } from "../src/launcher/row-model.ts";
import { NotificationStore } from "../src/notifications/store.ts";
import { parseRecents, RecentApps, recentEntries, remember } from "../src/recents.ts";
import { FileSearch, RETRY_MS } from "../src/shared/files/file-search.ts";
import { app, file } from "./support/launcher-fixtures.ts";

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
    const watched: Array<{ path: string; fire: () => void; closed: boolean; recursive: boolean }> = [];
    const timers: Array<() => void> = [];
    const index = new AppIndex({
      load: () => {
        loads += 1;
        return [app(`Load${loads}`)];
      },
      dirs: () => ["/home/alexk/.local/share/applications", "/usr/share/applications"],
      exists: (path) => path !== "/home/alexk/.local/share/applications",
      watch: (path, fire, recursive) => {
        const watcher = { path, fire, closed: false, recursive };
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
    // An applications directory with its subfolders (Wine's wine/Programs/); the parent of a missing one alone.
    expect(Object.fromEntries(open().map((each) => [each.path, each.recursive]))).toEqual({
      "/home/alexk/.local/share": false,
      "/usr/share/applications": true,
    });
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
