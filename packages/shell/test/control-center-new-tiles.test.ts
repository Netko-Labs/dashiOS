/**
 * A tile Dashi adds (0.10's Now Playing) joins a layout saved before it, once,
 * in its default place; removed afterwards, it stays removed (layout-store.ts,
 * layout.ts `withNewTiles`).
 */

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LAYOUT } from "../src/control-center/catalog.ts";
import { withNewTiles } from "../src/control-center/layout.ts";
import { LayoutStore } from "../src/control-center/layout-store.ts";

const MACHINE = "a".repeat(32);

/** What 0.9 wrote: the person's layout, no `known`. */
const saved09 = (items: { id: string; size: string }[]): string => `${JSON.stringify({ machines: { [MACHINE]: { items } } })}\n`;

function inDir(run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "cc-new-tiles-"));
  try {
    run(join(dir, "layout.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a layout saved by 0.9 gets Now Playing after the battery, and keeps what the person removed out", () => {
  inDir((path) => {
    // The person removed Dark and the keyboard light, and moved the battery up.
    writeFileSync(
      path,
      saved09([
        { id: "wifi", size: "wide" },
        { id: "battery", size: "flat" },
        { id: "volume", size: "tall" },
        { id: "focus", size: "round" },
      ]),
    );
    const ids = new LayoutStore(path, MACHINE).getSnapshot().map((tile) => tile.id);
    expect(ids).toEqual(["wifi", "battery", "nowplaying", "volume", "focus"]);
    // Saved once, with what it now knows.
    const file = JSON.parse(readFileSync(path, "utf8"));
    expect(file.machines[MACHINE].items.map((tile: { id: string }) => tile.id)).toEqual(ids);
    expect(file.machines[MACHINE].known).toContain("nowplaying");
    expect(file.machines[MACHINE].known).toContain("dark");
  });
});

test("removed after it joined, Now Playing stays removed", () => {
  inDir((path) => {
    writeFileSync(path, saved09([{ id: "wifi", size: "wide" }]));
    const first = new LayoutStore(path, MACHINE);
    expect(first.getSnapshot().map((tile) => tile.id)).toEqual(["wifi", "nowplaying"]);
    first.set([{ id: "wifi", size: "wide" }]);
    expect(new LayoutStore(path, MACHINE).getSnapshot()).toEqual([{ id: "wifi", size: "wide" }]);
  });
});

test("a new tile goes after the nearest default tile before it that the layout keeps, else first", () => {
  const known = new Set(["wifi", "ethernet", "brightness", "volume", "bluetooth", "focus", "dark", "power", "keyboard", "battery"]);
  // No battery: after the keyboard light.
  const layout = [
    { id: "keyboard", size: "wide" as const },
    { id: "wifi", size: "wide" as const },
  ];
  expect(withNewTiles(layout, known, DEFAULT_LAYOUT).map((tile) => tile.id)).toEqual(["keyboard", "nowplaying", "wifi"]);
  // Nothing before it kept: first.
  expect(withNewTiles([], known, DEFAULT_LAYOUT).map((tile) => tile.id)).toEqual(["nowplaying"]);
  // Already known (or already there): the layout as it was, the same object.
  const all = new Set([...known, "nowplaying"]);
  expect(withNewTiles(layout, all, DEFAULT_LAYOUT)).toBe(layout);
});

test("no file: the default layout, and nothing is written", () => {
  inDir((path) => {
    expect(new LayoutStore(path, MACHINE).getSnapshot()).toEqual(DEFAULT_LAYOUT);
    expect(() => readFileSync(path, "utf8")).toThrow();
  });
});
