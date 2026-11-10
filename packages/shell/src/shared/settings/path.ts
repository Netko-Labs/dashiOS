/** Where the person's settings live: `~/.config/dashi/settings.json`, or under `$XDG_CONFIG_HOME`. */

import { homedir } from "node:os";
import { join } from "node:path";

export function settingsPath(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "dashi", "settings.json");
}
