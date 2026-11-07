/**
 * Tests never read or write the person's own state: settings, Dark Mode
 * (control-center.json), the greeter's memory, notes in ~/Documents and the
 * like live under a fresh folder for each `bun test` run. HOME is that
 * folder's `home` (code that reads $HOME, such as Notes' store and Text
 * Editor's chooser, lands there; Bun's `os.homedir()` keeps the real one, so
 * code that writes there takes a path or an XDG folder instead).
 *
 * The root bunfig.toml preloads this for `bun run test`, and each package's
 * bunfig.toml for a `bun test` started in that package's folder.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "dashi-test-"));
for (const name of ["XDG_STATE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"]) {
  process.env[name] = join(root, name.slice(4, -5).toLowerCase());
}
const home = join(root, "home");
mkdirSync(home);
process.env.HOME = home;
