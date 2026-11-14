/**
 * The shell's reader of settings.json (settings/settings.ts) knows every section the Settings app
 * writes (settings-app/sections.ts): one it reads itself, or one another module reads. 0.9 printed
 * "unknown section voice" (and agents, screenSharing, dictation, persona) at every start and change.
 */

import { expect, test } from "bun:test";
import { parseSettings } from "../src/settings/settings.ts";
import { SECTIONS } from "../src/settings-app/sections.ts";

test("no section the Settings app writes is unknown to the shell", () => {
  const top = [...new Set(Object.values(SECTIONS).map((section) => section.path[0] ?? ""))];
  expect(top).toContain("voice");
  expect(top).toContain("persona");
  const { problems } = parseSettings(Object.fromEntries(top.map((name) => [name, {}])));
  expect(problems.filter((problem) => problem.startsWith("unknown section"))).toEqual([]);
});

test("a section nobody writes is still named", () => {
  expect(parseSettings({ nonsense: {} }).problems).toContain("unknown section nonsense");
});
