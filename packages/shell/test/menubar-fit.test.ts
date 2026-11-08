/**
 * The menu bar's status side when room runs out (menubar-fit.ts): extras
 * go first, the newest first, then Sound, then Wi-Fi; the clock, Control
 * Center, the battery, the agent mark and a recording never go, and "…"
 * takes room only when something went.
 */

import { describe, expect, test } from "bun:test";
import { extraGoes, type FitItem, fitStatus, GOES, MENU_GAP, MORE_WIDTH, statusRoom } from "../src/menubar-fit.ts";

/** The bar's items in its order: two extras (the newest leftmost), the mark, a recording, the status area, the clock. */
const bar = (): FitItem[] => [
  { key: "extra:new", width: 30, goes: extraGoes(0) },
  { key: "extra:old", width: 30, goes: extraGoes(1) },
  { key: "agent-mark", width: 40, goes: null },
  { key: "recording", width: 50, goes: null },
  { key: "battery", width: 38, goes: null },
  { key: "network", width: 29, goes: GOES.network },
  { key: "sound", width: 29, goes: GOES.sound },
  { key: "control-center", width: 29, goes: null },
  { key: "clock", width: 120, goes: null },
];
const total = bar().reduce((sum, item) => sum + item.width, 0);

describe("fitStatus", () => {
  test("everything fits: nothing hidden, no “…”", () => {
    expect(fitStatus(bar(), total, 0)).toEqual({ shown: bar().map((item) => item.key), hidden: [] });
  });

  test("a little short: the newest extra goes first, and “…” takes its room", () => {
    // 1 px short; with "…" (22) the newest extra (30) is enough to go.
    const fit = fitStatus(bar(), total - 1, 0, MORE_WIDTH);
    expect(fit.hidden).toEqual(["extra:new"]);
    expect(fit.shown).not.toContain("extra:new");
  });

  test("short by more than the extras: then Sound, then Wi-Fi", () => {
    // Without the extras the bar is 335 wide: 1 px short of that, with "…", Sound goes too.
    const room = total - 60 - 1 + MORE_WIDTH;
    expect(fitStatus(bar(), room, 0, MORE_WIDTH).hidden).toEqual(["extra:new", "extra:old", "sound"]);
    expect(fitStatus(bar(), room - 29, 0, MORE_WIDTH).hidden).toEqual(["extra:new", "extra:old", "network", "sound"]);
  });

  test("the clock, Control Center, the battery, the mark and a recording never go, however narrow", () => {
    const fit = fitStatus(bar(), 10, 0, MORE_WIDTH);
    expect(fit.shown).toEqual(["agent-mark", "recording", "battery", "control-center", "clock"]);
    expect(fit.hidden).toEqual(["extra:new", "extra:old", "network", "sound"]);
  });

  test("the hidden keep the bar's order, whatever order they went in", () => {
    const items: FitItem[] = [
      { key: "a", width: 30, goes: 2 },
      { key: "b", width: 30, goes: 0 },
      { key: "c", width: 30, goes: 1 },
    ];
    expect(fitStatus(items, 0, 0, 0).hidden).toEqual(["a", "b", "c"]);
    expect(fitStatus(items, 30, 0, 0)).toEqual({ shown: ["a"], hidden: ["b", "c"] });
  });

  test("gaps count between items", () => {
    const items: FitItem[] = [
      { key: "a", width: 10, goes: 0 },
      { key: "b", width: 10, goes: null },
    ];
    expect(fitStatus(items, 24, 4, 0).hidden).toEqual([]);
    expect(fitStatus(items, 23, 4, 0).hidden).toEqual(["a"]);
  });

  test("the room the menus leave keeps 24 px between them and the status side", () => {
    expect(statusRoom(1280, 400, 12)).toBe(1280 - 12 - 400 - MENU_GAP);
    expect(statusRoom(300, 400, 12)).toBe(0);
  });
});

describe("the bar's tooltip", () => {
  test("centered under its point, kept inside the bar", async () => {
    const { tipLeft, tipWidth } = await import("../src/bar-tip.tsx");
    expect(tipLeft(500, 200, 1100)).toBe(400);
    // Near the right end it stays 6 inside; near the left, 6 from it.
    expect(tipLeft(1090, 200, 1100)).toBe(1100 - 200 - 6);
    expect(tipLeft(20, 200, 1100)).toBe(6);
    expect(tipWidth("Claude Code · Cutting the demo video")).toBeGreaterThan(200);
    expect(tipWidth("x".repeat(500))).toBe(460);
  });
});
