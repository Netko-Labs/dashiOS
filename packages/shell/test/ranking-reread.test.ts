import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RankingMemory, rankEntries } from "../src/launcher/ranking/index.ts";
import { emptyMemory, serializeMemory } from "../src/launcher/ranking/lib/memory.ts";
import { index } from "./ranking-fixture.ts";

// Pass 42: the "emoji" picks taken out of ranking.json changed nothing until the session restarted.

const INDEX = index();
let dir = "";
let clock = 1_800_000_000_000;
const now = () => clock;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-ranking-"));
  clock = 1_800_000_000_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const first = (query: string, signals: RankingMemory) => rankEntries(INDEX, query, signals, 7)[0]?.name;

test("the history is read again when the file changes under the shell", () => {
  const path = join(dir, "ranking.json");
  const signals = new RankingMemory({ path, now, delayMs: 60_000 });
  signals.picked("te", "dev.dashi.editor");
  signals.flush();
  expect(first("te", signals)).toBe("Text Editor");
  // Its own write is not a change: the pick stays.
  clock += 5_000;
  expect(first("te", signals)).toBe("Text Editor");
  // The picks are taken out by hand.
  writeFileSync(path, serializeMemory(emptyMemory()));
  // Looked at no more than once a second.
  clock += 10;
  signals.picks("te");
  clock += 1_000;
  expect(first("te", signals)).toBe("Terminal");
});

test("a change on disk wins over one not yet written, which is never written over it", () => {
  const path = join(dir, "ranking.json");
  const signals = new RankingMemory({ path, now, delayMs: 60_000 });
  signals.picked("te", "dev.dashi.editor");
  writeFileSync(path, serializeMemory(emptyMemory()));
  clock += 2_000;
  expect(first("te", signals)).toBe("Terminal");
  signals.flush();
  expect(first("te", signals)).toBe("Terminal");
});
