import { expect, test } from "bun:test";
import { commandActions } from "../src/actions/sources/commands.ts";
import { arrangeActions } from "../src/actions/sources/windows.ts";
import { TOOL_ACTIONS } from "../src/agents/tools/index.ts";
import { clipboardActions } from "../src/clipboard/lib/actions.ts";
import { KEYMAP } from "../src/keymap/keymap.ts";
import { ADDRESS_GLYPHS, COMMAND_GLYPHS, commandGlyph } from "../src/launcher/lib/command-glyphs.ts";
import { launcherItems } from "../src/launcher/lib/items.ts";
import { actionRow } from "../src/launcher/row-model.ts";

const ICONS = { app: () => undefined, dashi: "/gear.svg" };
const actions = [
  ...commandActions(
    async () => {},
    KEYMAP,
    async () => {},
  ),
  ...clipboardActions({ open() {}, enabled: () => true, setEnabled() {}, count: () => 0, clear() {}, confirm: async () => false }),
  ...arrangeActions({
    windows: async () => [],
    appName: () => "",
    focus: async () => {},
    arrow: async () => {},
    tile: async () => {},
    fullscreen: async () => {},
    keymap: KEYMAP,
  }),
  ...TOOL_ACTIONS,
];

test("every command of Dashi's own the launcher lists draws its own glyph, never the gear", () => {
  // System Settings from the Dashi menu is the app's own row.
  const settings = { id: "dev.dashi.settings", name: "System Settings", icon: "/settings.svg", keywords: [], shell: true as const };
  const rows = launcherItems({ entries: [settings], actions })
    .filter((item) => item.kind === "command" && item.action)
    .map((item) => actionRow(item, ICONS));
  expect(rows.length).toBeGreaterThan(10);
  expect(rows.filter((row) => !("glyph" in row.icon)).map((row) => row.id)).toEqual([]);
  const titles = new Map(rows.map((row) => [row.title, row.icon]));
  for (const title of [
    "Clipboard History",
    "Snippets",
    "Clear Clipboard History",
    "Tile window left",
    "Clear notifications",
    "Screenshot…",
    "Screenshot of an Area…",
  ])
    expect(titles.has(title)).toBe(true);
});

test("each glyph is its own: no two commands share one (Lock Screen's tool row is Dashi's)", () => {
  const glyphs = [...Object.entries(COMMAND_GLYPHS), ...Object.entries(ADDRESS_GLYPHS).filter(([address]) => address !== "dashi://tool/lock-screen")];
  expect(new Set(glyphs.map(([, glyph]) => glyph)).size).toBe(glyphs.length);
});

test("an app's, an applet's or a script's command keeps its own picture", () => {
  expect(commandGlyph({ source: "apps", address: "dashi://app/notes/action/new" })).toBeUndefined();
  expect(commandGlyph({ source: "applets", address: "dashi://clipboard/history" })).toBeUndefined();
});
