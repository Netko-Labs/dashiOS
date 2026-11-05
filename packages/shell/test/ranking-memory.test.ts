import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RankingMemory, rankEntries, rankingPath } from "../src/launcher/ranking/index.ts";
import {
  emptyMemory,
  MAX_OPENED,
  MAX_PICKS_PER_QUERY,
  MAX_QUERIES,
  MAX_QUERY_LENGTH,
  OPEN_HALF_LIFE,
  parseMemory,
  pickKey,
  pickWeights,
  recordOpen,
  recordPick,
  serializeMemory,
} from "../src/launcher/ranking/memory.ts";
import { MAX_FILE_BYTES } from "../src/launcher/ranking/store.ts";
import { index } from "./ranking-fixture.ts";

const INDEX = index();
const DAY = 86_400_000;
let dir = "";
let clock = 1_800_000_000_000;
const now = () => clock;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-ranking-"));
  clock = 1_800_000_000_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A memory in the test's folder that writes only when flushed. */
const memory = (name = "ranking.json") => new RankingMemory({ path: join(dir, name), now, delayMs: 60_000 });
const names = (query: string, signals: RankingMemory, limit = 7) => rankEntries(INDEX, query, signals, limit).map((entry) => entry.name);

describe("what was picked for a query", () => {
  test("one pick of Text Editor for “te” puts it first for “te”, and for “t” that begins it", () => {
    const signals = memory();
    expect(names("te", signals)[0]).toBe("Terminal");
    signals.picked("te", "dev.dashi.editor");
    expect(names("te", signals)[0]).toBe("Text Editor");
    expect(names("t", signals)[0]).toBe("Text Editor");
    // A longer query it doesn't begin is its own: "ter" is Terminal's.
    expect(names("ter", signals)[0]).toBe("Terminal");
  });

  test("a pick is kept under the folded query: “TE ” and “te” are one", () => {
    const signals = memory();
    signals.picked("TE ", "dev.dashi.editor");
    expect(names("te", signals)[0]).toBe("Text Editor");
  });

  test("a pick never lifts a match above an exact name", () => {
    const signals = memory();
    for (let i = 0; i < 5; i++) signals.picked("files", "org.gnome.Nautilus");
    expect(names("files", signals)[0]).toBe("Files");
    // Without an exact name in the way, the pick decides.
    expect(names("file", signals)[0]).toBe("Files (Nautilus)");
  });

  test("Reset Ranking for one item, then for everything", () => {
    const signals = memory();
    signals.picked("te", "dev.dashi.editor");
    signals.picked("fi", "org.mozilla.firefox");
    signals.forget("dev.dashi.editor");
    expect(names("te", signals)[0]).toBe("Terminal");
    expect(names("fi", signals)[0]).toBe("Firefox");
    signals.forgetAll();
    expect(names("fi", signals)[0]).toBe("Files");
  });
});

describe("frecency", () => {
  test("what was opened most lately breaks a tie", () => {
    const signals = memory();
    expect(names("fi", signals)[0]).toBe("Files");
    for (let i = 0; i < 10; i++) signals.opened("org.mozilla.firefox");
    expect(names("fi", signals)[0]).toBe("Firefox");
  });

  test("but never beats a better match", () => {
    const signals = memory();
    for (let i = 0; i < 1000; i++) signals.opened("dev.dashi.settings/wallpaper");
    // Backups starts with "back"; Wallpaper only has "background" as a keyword.
    expect(names("back", signals)[0]).toBe("Backups");
    for (let i = 0; i < 1000; i++) signals.opened("dev.dashi.settings/battery");
    expect(names("ter", signals)).toEqual(["Terminal"]);
  });

  test("it decays: an opening is worth half after two weeks", () => {
    const signals = memory();
    signals.opened("dev.dashi.files");
    expect(signals.frecency("dev.dashi.files")).toBeCloseTo(1);
    clock += OPEN_HALF_LIFE;
    expect(signals.frecency("dev.dashi.files")).toBeCloseTo(0.5);
    signals.opened("dev.dashi.files");
    expect(signals.frecency("dev.dashi.files")).toBeCloseTo(1.5);
  });

  test("this week's habit overtakes last year's", () => {
    const signals = memory();
    for (let i = 0; i < 20; i++) signals.opened("org.mozilla.firefox");
    clock += 365 * DAY;
    for (let i = 0; i < 2; i++) signals.opened("dev.dashi.files");
    expect(signals.frecency("dev.dashi.files")).toBeGreaterThan(signals.frecency("org.mozilla.firefox"));
  });
});

describe("the bounds", () => {
  test("ids, queries and picks per query are capped; the stalest go first", () => {
    const state = emptyMemory();
    for (let i = 0; i < MAX_OPENED + 200; i++) recordOpen(state, `app-${i}`, clock + i);
    expect(state.opened.size).toBe(MAX_OPENED);
    expect(state.opened.has(`app-${MAX_OPENED + 199}`)).toBe(true);
    for (let i = 0; i < MAX_QUERIES + 50; i++) recordPick(state, `query ${i}`, "app", clock);
    expect(state.picked.size).toBe(MAX_QUERIES);
    expect(state.picked.has(pickKey("query 0"))).toBe(false);
    for (let i = 0; i < MAX_PICKS_PER_QUERY + 5; i++) recordPick(state, "same", `app-${i}`, clock + i);
    expect(state.picked.get("same")?.size).toBe(MAX_PICKS_PER_QUERY);
  });

  test("a long query is kept by its start; a bad id is not kept at all", () => {
    const state = emptyMemory();
    recordPick(state, "x".repeat(200), "app", clock);
    expect([...state.picked.keys()]).toEqual(["x".repeat(MAX_QUERY_LENGTH)]);
    recordOpen(state, "", clock);
    recordOpen(state, "bad\nid", clock);
    recordOpen(state, "y".repeat(1000), clock);
    expect([...state.opened.keys()]).toEqual(["app"]);
  });

  test("a pick for a longer query counts at half for a query that begins it", () => {
    const state = emptyMemory();
    recordPick(state, "set", "settings", clock);
    recordPick(state, "se", "sound", clock);
    expect(Object.fromEntries(pickWeights(state, "se", clock))).toEqual({ settings: 0.5, sound: 1 });
    expect(Object.fromEntries(pickWeights(state, "set", clock))).toEqual({ settings: 1 });
  });
});

describe("the file", () => {
  test("lives next to recents.json", () => {
    expect(rankingPath({ XDG_STATE_HOME: "/state" })).toBe("/state/dashi/ranking.json");
    expect(rankingPath({ HOME: "/home/alexk" })).toBe("/home/alexk/.local/state/dashi/ranking.json");
  });

  test("is written once after a burst of changes, readable by its owner only", async () => {
    const path = join(dir, "state", "dashi", "ranking.json");
    const signals = new RankingMemory({ path, now, delayMs: 20 });
    signals.opened("dev.dashi.files");
    signals.picked("te", "dev.dashi.editor");
    expect(() => statSync(path)).toThrow();
    await Bun.sleep(80);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const again = new RankingMemory({ path, now });
    expect(again.frecency("dev.dashi.files")).toBeCloseTo(1);
    expect(names("te", again)[0]).toBe("Text Editor");
  });

  test("flush writes now, and only when something changed", () => {
    const path = join(dir, "ranking.json");
    const signals = new RankingMemory({ path, now, delayMs: 60_000 });
    signals.flush();
    expect(() => statSync(path)).toThrow();
    signals.opened("dev.dashi.files");
    signals.close();
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ version: 1, opened: { "dev.dashi.files": [1, clock] } });
  });

  test("a damaged file is an empty history, and the next write replaces it", () => {
    const path = join(dir, "ranking.json");
    for (const junk of ["{", "null", "[]", '{"version":2}', '{"version":1,"opened":{"a":"x","b":[1]},"picked":{"te":{"c":[-1,0]}}}']) {
      writeFileSync(path, junk);
      const signals = new RankingMemory({ path, now });
      expect(signals.frecency("a")).toBe(0);
      expect(signals.picks("te").size).toBe(0);
    }
    const signals = new RankingMemory({ path, now });
    signals.opened("dev.dashi.files");
    signals.flush();
    expect(new RankingMemory({ path, now }).frecency("dev.dashi.files")).toBeCloseTo(1);
  });

  test("an oversized file is not read", () => {
    const path = join(dir, "ranking.json");
    const real = serializeMemory(parseMemory(`{"version":1,"opened":{"dev.dashi.files":[5,${clock}]},"picked":{}}`, clock));
    writeFileSync(path, real.replace("}", `,"pad":"${"x".repeat(MAX_FILE_BYTES)}"}`));
    expect(new RankingMemory({ path, now }).frecency("dev.dashi.files")).toBe(0);
    writeFileSync(path, real);
    expect(new RankingMemory({ path, now }).frecency("dev.dashi.files")).toBeCloseTo(5);
  });

  test("survives a round trip", () => {
    const state = emptyMemory();
    recordPick(state, "set", "dev.dashi.settings", clock);
    recordOpen(state, "file:///home/alexk/Report.odt", clock);
    const back = parseMemory(serializeMemory(state), clock);
    expect(back).toEqual(state);
  });
});
