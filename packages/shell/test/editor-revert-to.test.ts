import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EditorModel } from "../apps/editor/lib/model.ts";
import { DEFAULT_PREFS } from "../apps/editor/lib/prefs.ts";
import { VersionStore } from "../apps/editor/lib/versions.ts";

test("Revert To has nothing for a file until it is written over", () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-editor-revert-to-"));
  try {
    const path = join(dir, "fresh.txt");
    writeFileSync(path, "as opened");
    const clock = Date.now() + 60_000;
    const editor = new EditorModel({
      loadPrefs: () => DEFAULT_PREFS,
      savePrefs: () => {},
      versions: new VersionStore(join(dir, "versions")),
      now: () => clock,
    });
    editor.open(path);
    expect(editor.hasVersions).toBe(false);
    editor.edit("changed");
    expect(editor.autosave()).toBe("saved");
    expect(editor.hasVersions).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
