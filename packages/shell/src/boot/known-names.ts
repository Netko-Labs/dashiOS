/**
 * The names the computer knows (dictation/lib/seed.ts, D198), looked up for dictation's vocabulary and the assistant's
 * ears: the installed apps, the folders at the top of the person's home and at the top of the one that holds their
 * projects (~/Developer), and the sites they allowed agents. Nothing here fails: what can't be read is left out.
 */

import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { allowedSites } from "../agents/index.ts";
import type { KnownNames } from "../dictation/index.ts";

/** Folders people keep projects in: their own top level is read too. */
const PROJECT_ROOTS = new Set(["developer", "development", "projects", "proyectos", "code", "src", "dev", "git", "repos", "workspace", "work"]);

function folders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function knownNames(apps: () => readonly string[], home: string = homedir()): () => KnownNames {
  return () => {
    const top = folders(home);
    const inside = top.filter((name) => PROJECT_ROOTS.has(name.toLowerCase())).flatMap((name) => folders(join(home, name)));
    return { apps: apps(), folders: [...inside, ...top], sites: allowedSites() };
  };
}
