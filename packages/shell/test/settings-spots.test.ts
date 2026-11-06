import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SETTING_ROWS, SPOT_ROWS, settingsActions } from "../src/actions/sources/settings.ts";
import type { Entry } from "../src/entries.ts";
import { launcherIndex } from "../src/launcher/items.ts";
import { buildSections, selectable } from "../src/launcher/rows.ts";
import { PANES } from "../src/settings-app/panes.ts";
import { paneEntry, paneKeywords, paneLook } from "../src/settings-app/search.ts";

// A search that names a row of Settings lands on the row: Settings opens scrolled to it and lights it, as a link does.

const src = join(import.meta.dir, "../src");
const ICONS = { calculator: "/calc.svg", files: "/files.svg", software: "/software.svg", command: "/dashi.svg" };

/** Every `<Spot pane row>` the panes draw, as "pane/row". */
function spots(): Set<string> {
  const found = new Set<string>();
  for (const file of new Bun.Glob("**/*.tsx").scanSync(src)) {
    for (const match of readFileSync(join(src, file), "utf8").matchAll(/<Spot pane="([^"]+)" row="([^"]+)"/g)) found.add(`${match[1]}/${match[2]}`);
  }
  return found;
}

/** Every place with a row that an action names: the settings source's rows, and the rows of the other sources (radios, clipboard). */
function placesNamed(): string[] {
  const places = [...SETTING_ROWS, ...SPOT_ROWS].map((row) => `${row.pane}/${row.row}`);
  for (const file of ["actions/sources/radios.ts", "clipboard/actions.ts"]) {
    const text = readFileSync(join(src, file), "utf8");
    for (const match of text.matchAll(/pane: "([^"]+)",\s*row: "([^"]+)"/g)) places.push(`${match[1]}/${match[2]}`);
  }
  return places;
}

test("every launcher row that names a Settings row has its Spot in that pane", () => {
  const drawn = spots();
  const named = placesNamed();
  expect(named.length).toBeGreaterThan(SETTING_ROWS.length + SPOT_ROWS.length);
  expect(named.filter((place) => !drawn.has(place))).toEqual([]);
  // Each address is one row.
  expect(new Set(SPOT_ROWS.map((row) => `${row.pane}/${row.row}`)).size).toBe(SPOT_ROWS.length);
  for (const row of SPOT_ROWS) expect(SETTING_ROWS.some((each) => each.pane === row.pane && each.row === row.row)).toBe(false);
});

test("“text size” lands on the Text size row, which opens Settings at it", async () => {
  const entries: Entry[] = PANES.map((pane) => ({
    ...paneEntry(pane),
    keywords: paneKeywords(pane),
    ...paneLook(pane),
    fallbackKeywords: ["settings"],
    shell: true,
  }));
  const opened: [string, string | undefined][] = [];
  const actions = settingsActions({ state: () => null, open: (pane, row) => void opened.push([pane, row]) });
  const index = launcherIndex({ entries, actions });
  for (const [query, title, place] of [
    ["text size", "Text size", { pane: "appearance", row: "text-size" }],
    ["font size", "Text size", { pane: "appearance", row: "text-size" }],
    ["reduce motion", "Reduce motion", { pane: "appearance", row: "reduce-motion" }],
    ["time zone", "Time zone", { pane: "date-time", row: "time-zone" }],
    ["tap to click", "Tap to click", { pane: "trackpad", row: "tap-to-click" }],
  ] as const) {
    const first = selectable(buildSections({ query, entries, recent: [], files: { kind: "none" }, icons: ICONS, index }))[0];
    expect([query, first?.title, first?.action.kind, first?.item?.action?.place]).toEqual([query, title, "reveal", place]);
    expect(first?.detail).toBe(PANES.find((pane) => pane.id === place.pane)?.title);
  }
  const textSize = actions.find((action) => action.address === "dashi://settings/appearance/text-size");
  const checked = textSize?.check({});
  if (!checked || !("run" in checked)) throw new Error("not ready");
  await checked.run({ window: null });
  expect(opened).toEqual([["appearance", "text-size"]]);
});
