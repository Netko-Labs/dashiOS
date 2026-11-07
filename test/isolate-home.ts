/**
 * Tests never read or write the person's own state: settings, Dark Mode
 * (control-center.json), the greeter's memory and the like live under a
 * fresh folder for each `bun test` run.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "dashi-test-"));
for (const name of ["XDG_STATE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"]) {
  process.env[name] = join(root, name.slice(4, -5).toLowerCase());
}
