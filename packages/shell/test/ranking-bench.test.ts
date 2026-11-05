/**
 * The typing budget (betterments.html, "Speed"): ranking a 5,000-item index
 * (apps, panes, windows, thousands of menu rows) takes under 2 ms a
 * keystroke. The bound asserted here is generous, so a busy machine doesn't
 * fail it; the timing is printed for the record.
 */

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, RankingMemory, rank } from "../src/launcher/ranking/index.ts";
import { syntheticItems, WORDS } from "./ranking-fixture.ts";

const TYPED = ["terminal", "system settings", "fierfox", "dark mode", "wif", "new window", "ecran", "ss", "export as pdf", "zoom in"];

test("ranking 5,000 items stays inside the typing budget", () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-ranking-bench-"));
  try {
    const all = syntheticItems(5000);
    expect(all).toHaveLength(5000);
    const started = performance.now();
    const index = buildIndex(all);
    const built = performance.now() - started;
    const signals = new RankingMemory({ path: join(dir, "ranking.json"), delayMs: 60_000 });
    for (let i = 0; i < 300; i++) signals.opened(`menu-${i * 7}`);
    for (let i = 0; i < 100; i++) signals.picked(WORDS[i % WORDS.length]?.slice(0, 3) ?? "x", `app-${i}`);
    const keystrokes = TYPED.flatMap((query) => Array.from({ length: query.length }, (_, i) => query.slice(0, i + 1)));
    // Warm up the JIT, as the shell's would be after its first launcher.
    for (let round = 0; round < 3; round++) for (const query of keystrokes) rank(index, query, { signals, limit: 8 });
    const times: number[] = [];
    for (let round = 0; round < 5; round++) {
      for (const query of keystrokes) {
        const start = performance.now();
        rank(index, query, { signals, limit: 8 });
        times.push(performance.now() - start);
      }
    }
    times.sort((a, b) => a - b);
    const mean = times.reduce((sum, each) => sum + each, 0) / times.length;
    const median = times[Math.floor(times.length / 2)] as number;
    const p95 = times[Math.floor(times.length * 0.95)] as number;
    console.log(
      `ranking 5,000 items: index built in ${built.toFixed(1)} ms; per keystroke mean ${mean.toFixed(3)} ms, median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, max ${(times.at(-1) as number).toFixed(3)} ms (${times.length} keystrokes)`,
    );
    // The budget is 2 ms; a loaded test machine gets four times that before this fails.
    expect(mean).toBeLessThan(8);
    // The answers are still right at this size.
    expect(rank(index, "terminal", { limit: 1 })[0]?.item.id).toBe("dev.dashi.terminal");
    expect(rank(index, "fierfox", { limit: 1 })[0]?.item.id).toBe("org.mozilla.firefox");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
