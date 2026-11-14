// How Settings reads the settings file (settings-app/sections.ts): each key by its shape, a bad one never losing the rest.
import { expect, test } from "bun:test";
import { parseSettings } from "../src/settings/settings.ts";
import { readSettings, SECTIONS } from "../src/settings-app/sections.ts";

test("a key with a bad value reads as not set, and the section's other keys stay", () => {
  const read = readSettings({
    nightShift: { from: "21:00", to: "25:00", kelvin: 3400 },
    clipboard: { history: false, leftOut: ["org.keepassxc.KeePassXC", "no spaces allowed"], snippetsInTerminals: true },
    power: { mode: "balanced", chargeLimit: 10, fullBy: "8:30", batteryMaxKhz: 3_900_000 },
    region: { formats: "not a locale!", firstWeekday: "monday" },
  });
  expect(read.nightShift).toEqual({ from: "21:00", kelvin: 3400 });
  expect(read.clipboard).toEqual({ history: false, snippetsInTerminals: true });
  expect(read.power).toEqual({ mode: "balanced", fullBy: "8:30", batteryMaxKhz: 3_900_000 });
  expect(read.region).toEqual({ firstWeekday: "monday" });
});

test("a section that is not an object, and a file that is not one, read as nothing set", () => {
  expect(readSettings({ agents: ["claude"], screenSharing: "all" }).agents).toEqual({});
  expect(readSettings({ screenSharing: { clients: ["/usr/bin/obs", "relative/path"] } }).screenSharing).toEqual({});
  expect(readSettings(null).launcher).toEqual({});
});

test("a list is kept whole when every entry is good", () => {
  const read = readSettings({ screenSharing: { clients: ["/usr/bin/obs"] }, launcher: { aliases: { ff: "dashi://app/org.mozilla.firefox" } } });
  expect(read.screenSharing).toEqual({ clients: ["/usr/bin/obs"] });
  expect(read.launcher).toEqual({ aliases: { ff: "dashi://app/org.mozilla.firefox" } });
});

test("the shell's own reader knows every section the settings are kept in: none prints as unknown at start", () => {
  const tops = [...new Set(Object.values(SECTIONS).map((section) => section.path[0] ?? ""))];
  const { problems } = parseSettings(Object.fromEntries(tops.map((top) => [top, {}])));
  expect(problems.filter((problem) => problem.startsWith("unknown section"))).toEqual([]);
  expect(parseSettings({ nonsense: {} }).problems).toContain("unknown section nonsense");
});
