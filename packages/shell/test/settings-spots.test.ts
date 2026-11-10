import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { settingsActions } from "../src/actions/lib/sources/settings.ts";
import type { Entry } from "../src/entries.ts";
import { launcherIndex } from "../src/launcher/items.ts";
import { buildSections, selectable } from "../src/launcher/rows.ts";
import { findRow, rowPlace, SETTINGS_ROWS } from "../src/settings-app/registry/index.ts";
import { paneEntry, paneKeywords, paneLook } from "../src/settings-app/search.ts";
import { PANES } from "../src/shared/settings/panes.ts";

// A search that names a row of Settings lands on the row: Settings opens scrolled to it and lights it, as a link does.

const src = join(import.meta.dir, "../src");
const ICONS = { calculator: "/calc.svg", files: "/files.svg", software: "/software.svg", command: "/dashi.svg" };

/** The places the other action sources name (radios, clipboard): each is a row of the registry that says so. */
test("a row another source lists is in the registry, marked as that source's", () => {
  const named: string[] = [];
  for (const file of ["actions/radios.ts", "clipboard/actions.ts"]) {
    const text = readFileSync(join(src, file), "utf8");
    for (const match of text.matchAll(/pane: "([^"]+)",\s*row: "([^"]+)"/g)) named.push(`${match[1]}/${match[2]}`);
  }
  expect(named.length).toBeGreaterThan(0);
  expect(named.filter((id) => findRow(id)?.source === undefined)).toEqual([]);
  expect(SETTINGS_ROWS.filter((row) => row.source !== undefined).map((row) => row.id)).toEqual(expect.arrayContaining(named));
  // And the settings source leaves them to it: one action per address.
  const addresses = settingsActions({ state: () => null, open: () => {} }).map((action) => action.address);
  expect(new Set(addresses).size).toBe(addresses.length);
  for (const id of named) expect(addresses).not.toContain(`dashi://settings/${id}`);
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
    // Rows the launcher found nothing for before the registry.
    ["kernel", "Kernel", { pane: "about", row: "kernel" }],
    ["charge limit", "Charge limit", { pane: "battery", row: "charge-limit" }],
  ] as const) {
    const first = selectable(buildSections({ query, entries, recent: [], files: { kind: "none" }, icons: ICONS, index }))[0];
    expect([query, first?.title, first?.item?.action?.place]).toEqual([query, title, place]);
    expect(first?.detail).toBe(PANES.find((pane) => pane.id === place.pane)?.title);
  }
  const kernel = actions.find((action) => action.address === "dashi://settings/about/kernel");
  const checked = kernel?.check({});
  if (!checked || !("run" in checked)) throw new Error("not ready");
  await checked.run({ window: null });
  expect(opened).toEqual([["about", "kernel"]]);
  expect(rowPlace({ id: "about/kernel" })).toEqual({ pane: "about", row: "kernel" });
});
