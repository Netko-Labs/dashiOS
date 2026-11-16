/**
 * The desktop files on this computer that are not apps a person opens: a
 * library's helper (`NoDisplay`, as Fcitx's Qt 6 wrapper is), one that is
 * `Hidden`, not an `Application`, or meant for another desktop. The Store's
 * Installed leaves a package out when its desktop file is one of these
 * (pass 37: "Fcitx5 qt Qt6gui" was listed as an app). The first folder with
 * an id has it, as for the launcher's list (app-entries/entries.ts).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { desktopFiles, parseDesktopEntry } from "./desktop-entry.ts";
import { dataDirs } from "./icons.ts";

export function unlistedDesktopIds(
  dirs: readonly string[] = dataDirs().map((dir) => join(dir, "applications")),
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): Set<string> {
  const seen = new Set<string>();
  const unlisted = new Set<string>();
  for (const dir of dirs) {
    for (const { id, path } of desktopFiles(dir)) {
      if (seen.has(id)) continue;
      seen.add(id);
      let entry: ReturnType<typeof parseDesktopEntry>;
      try {
        entry = parseDesktopEntry(id, read(path));
      } catch {
        continue;
      }
      if (entry === null || entry.hidden) unlisted.add(id);
    }
  }
  return unlisted;
}
