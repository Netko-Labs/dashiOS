import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "../src/settings/index.ts";
import { readMotionSettings } from "../src/shared/appearance/index.ts";

test("the portal reads Reduce Motion and the pointer's size as the shell does, whatever the file holds", () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-motion-"));
  const path = join(dir, "settings.json");
  const files: Array<string | null> = [
    null,
    "{ not json",
    "[]",
    JSON.stringify({}),
    JSON.stringify({ appearance: "dark" }),
    JSON.stringify({ appearance: { reduceMotion: true, pointerSize: 40 } }),
    JSON.stringify({ appearance: { reduceMotion: "yes", pointerSize: 33, cornerRadius: "huge" } }),
    JSON.stringify({ appearance: { pointerSize: 48, wallpaper: { path: "aurora" } }, dock: { style: "nope" } }),
  ];
  for (const [index, text] of files.entries()) {
    const file = join(dir, `${index}.json`);
    if (text !== null) writeFileSync(file, text);
    const shell = loadSettings(file).settings.appearance;
    expect([text, readMotionSettings(file)]).toEqual([text, { reduceMotion: shell.reduceMotion, pointerSize: shell.pointerSize }]);
  }
  writeFileSync(path, JSON.stringify({ appearance: { reduceMotion: true, pointerSize: 32 } }));
  expect(readMotionSettings(path)).toEqual({ reduceMotion: true, pointerSize: 32 });
});
