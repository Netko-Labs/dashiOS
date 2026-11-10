/**
 * The settings registry: every row of System Settings once, each drawn by
 * its pane, each at its address, and each one-value row reading and
 * changing through the settings store.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSegment } from "../src/actions/address.ts";
import { parseCall } from "../src/agents/tools/registry.ts";
import { DockPrefs } from "../src/dock/prefs.ts";
import {
  AGENT_ROWS,
  accepts,
  agentRow,
  changedWords,
  describeValue,
  findRow,
  type RegistryStores,
  rowName,
  rowPlace,
  SETTINGS_ROWS,
  type SettingValue,
  type ValueSchema,
  wrongValue,
} from "../src/settings-app/registry/index.ts";
import { SettingsStore } from "../src/settings-app/store.ts";
import { FlagsStore } from "../src/shared/control-center/flags.ts";
import { isPaneId } from "../src/shared/settings/panes.ts";

const dir = mkdtempSync(join(tmpdir(), "dashi-registry-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const src = join(import.meta.dir, "../src/settings-app");
/** Every pane's source, and the parts they are drawn from. */
const paneSources = (): Map<string, string> => {
  const sources = new Map<string, string>();
  for (const file of new Bun.Glob("panes/*.tsx").scanSync(src)) sources.set(file, readFileSync(join(src, file), "utf8"));
  return sources;
};

describe("the rows", () => {
  test("each is one row, at an address of its pane", () => {
    const ids = SETTINGS_ROWS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of SETTINGS_ROWS) {
      const { pane, row: part } = rowPlace(row);
      expect([row.id, isPaneId(pane), isSegment(part)]).toEqual([row.id, true, true]);
      expect(findRow(row.id)).toBe(row);
      expect(row.title.trim()).toBe(row.title);
      for (const word of row.keywords ?? []) expect(word).toBe(word.toLowerCase());
    }
  });

  test("a value's schema is its kind's: a switch takes true or false, a choice its options", () => {
    for (const row of SETTINGS_ROWS) {
      if (row.kind === "choice" && row.value) expect([row.id, row.options !== undefined]).toEqual([row.id, true]);
      if (!row.value) continue;
      const { schema } = row.value;
      if (row.kind === "switch") expect([row.id, schema.type]).toEqual([row.id, "boolean"]);
      if (row.kind === "choice" && row.options) {
        expect([row.id, "enum" in schema ? [...schema.enum].map(String) : null]).toEqual([row.id, row.options.map((option) => String(option.value))]);
      }
    }
  });

  test("agents' names are unique, snake_case, and only on rows that are one value", () => {
    const names = AGENT_ROWS.map((row) => row.agent);
    expect(new Set(names).size).toBe(names.length);
    for (const row of SETTINGS_ROWS.filter((each) => each.agent !== undefined)) {
      expect([row.id, /^[a-z][a-z0-9_]*$/.test(row.agent ?? ""), row.value !== undefined]).toEqual([row.id, true, true]);
    }
    // Rows that guard the person are never an agent's to change.
    for (const pane of ["lock-screen", "users", "passwords", "agents", "privacy"]) {
      expect(AGENT_ROWS.filter((row) => rowPlace(row).pane === pane)).toEqual([]);
    }
  });
});

describe("drawn by the panes", () => {
  const sources = paneSources();
  const all = [...sources.values()].join("\n");

  test("every row of the registry is drawn by its pane", () => {
    const missing = SETTINGS_ROWS.filter((row) => !all.includes(`"${row.id}"`)).map((row) => row.id);
    expect(missing).toEqual([]);
  });

  test("every row a pane draws is in the registry: no pane draws a plain row with a label of its own", () => {
    for (const [file, text] of sources) {
      // Settings' rows are Settings; data (a login, a device) is an Item; a form's fields are FormRows.
      expect([file, /<Row[\s>]/.test(text)]).toEqual([file, false]);
      expect([file, /<Item[^>]*\slabel="/.test(text)]).toEqual([file, false]);
      for (const match of text.matchAll(/<(?:Setting|Spot|SpeedRow|ScrollSpeedRow)\s[^>]*?id="([^"]+)"/g)) {
        expect([file, match[1], findRow(match[1] ?? "") !== undefined]).toEqual([file, match[1], true]);
      }
    }
  });
});

describe("values", () => {
  const stores = (): RegistryStores & { settings: SettingsStore } => ({
    settings: new SettingsStore(join(dir, `settings-${Math.random()}.json`)),
    flags: new FlagsStore(null),
  });

  /** A value the row takes that isn't the one it holds. */
  function another(schema: ValueSchema, now: SettingValue | null): SettingValue {
    switch (schema.type) {
      case "boolean":
        return now !== true;
      case "string":
        return schema.enum.find((value) => value !== now) ?? (schema.enum[0] as string);
      case "number":
        if ("enum" in schema) return schema.enum.find((value) => value !== now) ?? (schema.enum[0] as number);
        return now === schema.maximum ? schema.minimum : schema.maximum;
    }
  }

  test("every one-value row reads back what it was set to, through settings.json", () => {
    const at = stores();
    for (const row of SETTINGS_ROWS) {
      if (!row.value) continue;
      const before = row.value.get(at);
      const next = another(row.value.schema, before);
      expect([row.id, accepts(row.value.schema, next)]).toEqual([row.id, true]);
      row.value.set(at, next);
      expect([row.id, row.value.get(at)]).toEqual([row.id, next]);
    }
    expect(at.settings.getSnapshot().error).toBeNull();
    // Written where the panes read them.
    const data = at.settings.getSnapshot().data;
    expect(data.appearance.reduceMotion).toBe(true);
    expect(data.touchpad.tap).toBe(true);
  });

  test("a default is written as no setting: scrolling speed 1, clipboard history on", () => {
    const at = stores();
    const speed = findRow("trackpad/scrolling-speed");
    speed?.value?.set(at, 2);
    expect(at.settings.getSnapshot().data.touchpad.scrollSpeed).toBe(2);
    speed?.value?.set(at, 1);
    expect(at.settings.getSnapshot().data.touchpad.scrollSpeed).toBeUndefined();
    expect(speed?.value?.get(at)).toBe(1);
    const history = findRow("keyboard/clipboard-history");
    history?.value?.set(at, false);
    expect(at.settings.getSnapshot().data.clipboard.history).toBe(false);
    history?.value?.set(at, true);
    expect(at.settings.getSnapshot().data.clipboard.history).toBeUndefined();
    const week = findRow("language-region/first-day-of-week");
    week?.value?.set(at, "monday");
    week?.value?.set(at, "auto");
    expect(at.settings.getSnapshot().data.region.firstWeekday).toBeUndefined();
  });

  test("the Dock's rows go through the Dock's store when the shell runs one", () => {
    const at = stores();
    const dock = new DockPrefs((change) => at.settings.patch("dock", change));
    const style = findRow("desktop-dock/style");
    style?.value?.set({ ...at, dock }, "taskbar");
    expect(dock.snapshot.style).toBe("taskbar");
    expect(at.settings.getSnapshot().data.dock.style).toBe("taskbar");
    expect(style?.value?.get(at)).toBe("taskbar");
  });

  test("Control Center's switches are flags, not the file", () => {
    const at = stores();
    findRow("appearance/dark-mode")?.value?.set(at, true);
    findRow("notifications/do-not-disturb")?.value?.set(at, true);
    expect(at.flags.getSnapshot()).toMatchObject({ dark: true, dnd: true, night: false });
  });

  test("checked, and said, in the agents' words", () => {
    expect(accepts({ type: "boolean" }, "yes")).toBe(false);
    expect(accepts({ type: "number", minimum: 0.25, maximum: 4 }, 9)).toBe(false);
    expect(accepts({ type: "number", enum: [24, 32] }, 32)).toBe(true);
    expect(accepts({ type: "number", minimum: 0, maximum: 1 }, Number.NaN)).toBe(false);
    expect(wrongValue({ type: "number", minimum: 0.25, maximum: 4 })).toBe("`value` must be a number from 0.25 to 4.");
    expect(wrongValue({ type: "string", enum: ["dock", "taskbar"] })).toBe("`value` must be one of: dock, taskbar.");
    const pointer = findRow("appearance/pointer-size");
    if (!pointer) throw new Error("no pointer size");
    expect(describeValue(pointer, 32)).toBe("Large");
    expect(changedWords(pointer, 32, true)).toBe("Set Pointer size to Large.");
    expect(changedWords(pointer, 32, false)).toBe("Pointer size is Large already.");
    const dark = findRow("appearance/dark-mode");
    if (!dark) throw new Error("no Dark Mode");
    expect(changedWords(dark, true, true)).toBe("Dark Mode is on.");
    expect(rowName(findRow("graphics/mode") ?? dark)).toBe("Graphics mode");
  });
});

describe("agents", () => {
  test("set_setting takes every row named for agents, by the registry's checks", () => {
    expect(agentRow("text_size")?.id).toBe("appearance/text-size");
    expect(parseCall({ name: "set_setting", arguments: { name: "text_size", value: 1.3 } })).toEqual({ name: "set_setting", setting: "text_size", value: 1.3 });
    expect(parseCall({ name: "set_setting", arguments: { name: "text_size", value: 2 } })).toEqual({ arguments: "`value` must be one of: 1, 1.15, 1.3, 1.5." });
    expect(parseCall({ name: "set_setting", arguments: { name: "trackpad_tap_to_click", value: true } })).toMatchObject({ setting: "trackpad_tap_to_click" });
    // A row without an agents' name is the person's alone.
    expect(parseCall({ name: "set_setting", arguments: { name: "show_dock", value: false } })).toMatchObject({
      arguments: expect.stringContaining("`name` must be one of"),
    });
  });
});
