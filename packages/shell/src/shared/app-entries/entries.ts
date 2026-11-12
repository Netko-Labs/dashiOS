/**
 * Installed apps as the launcher, the Dock and Activity Monitor see them:
 * freedesktop `.desktop` entries (the XDG application directories, read by
 * shared/apps/desktop-entry.ts) plus Dashi's own pinned and first-party apps,
 * with icons resolved from the icon theme (shared/apps/icons.ts). The shell
 * adds what opens in it (src/entries.ts).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type App,
  cachedIcon,
  dataDirs,
  desktopFiles,
  firstPartyApps,
  firstPartyKeywords,
  iconRoots,
  inTerminal,
  parseDesktopEntry,
  resolvePinned,
} from "../apps/index.ts";
import type { Entry } from "./types.ts";

/** "org.kde.konsole" → "Konsole"; falls back to the window title. */
export function appIdName(appId: string, title: string): string {
  const last = appId.split(".").filter(Boolean).at(-1);
  if (!last) return title || "Untitled";
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** What else a pinned app is found by: its id and its command's name, lowercased. */
export function pinnedKeywords(app: Pick<App, "id" | "exec">): string[] {
  const command = app.exec?.[0]?.split("/").at(-1);
  return [...new Set([app.id, command].filter((word): word is string => Boolean(word)).map((word) => word.toLowerCase()))];
}

/**
 * Entries that share a name (Dashi's own Files and Nautilus, both "Files")
 * get a word in parentheses that tells them apart: "Dashi" for Dashi's own
 * apps, otherwise the last part of the app id ("Files (Nautilus)"), or what
 * `nameOf` calls it (the shell names an applet by its manifest, apps.ts
 * `displayName`).
 */
export function withDistinctNames(entries: Entry[], nameOf: (appId: string, title: string) => string = appIdName): Entry[] {
  // Hidden entries are never listed beside the others, so they neither need a distinct name nor give one.
  const counts = new Map<string, number>();
  for (const entry of entries) if (!entry.hidden) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  return entries.map((entry) => {
    if (entry.hidden || (counts.get(entry.name) ?? 0) < 2) return entry;
    const tag = entry.id.startsWith("dev.dashi.") ? "Dashi" : nameOf(entry.id.replace(/\.desktop$/, ""), entry.name);
    return tag === entry.name ? entry : { ...entry, name: `${entry.name} (${tag})` };
  });
}

/**
 * An installed entry as the launcher starts it: one with `Terminal=true`
 * runs in the pinned Terminal (apps.ts `inTerminal`); null when there is no
 * terminal to run it in.
 */
export function launchable<T extends Pick<Entry, "exec" | "cwd" | "env" | "terminal">>(
  entry: T,
  terminal: (argv: readonly string[]) => Pick<App, "exec" | "cwd" | "env"> | null = inTerminal,
): T | null {
  if (!entry.terminal) return entry;
  const wrapped = terminal(entry.exec ?? []);
  return wrapped ? { ...entry, ...wrapped } : null;
}

/** What `readEntries` is given. */
export interface EntryOptions {
  /** Add the `NoDisplay` entries, which only name windows (app-catalog.ts), never a list. */
  withHidden?: boolean;
  /** What opens in the shell itself (entries.ts `shellEntries`), after the pinned apps; none outside the shell. */
  shell?: Entry[];
  /** What tells two entries of one name apart (`withDistinctNames`). */
  nameOf?: (appId: string, title: string) => string;
}

/** The installed apps: the pinned ones, `shell`, Dashi's first-party apps, then the desktop entries. */
export function readEntries(options: EntryOptions = {}): Entry[] {
  // A pinned app stands in for its desktop entry (the pinned Terminal is
  // foot.desktop), so it answers to that entry's id and command too.
  const entries: Entry[] = resolvePinned().map((app) => ({ ...app, keywords: pinnedKeywords(app) }));
  entries.push(...(options.shell ?? []));
  // Dashi's own apps that run as their own process (shared/apps/first-party.ts); found by their words, not by "bun".
  for (const app of firstPartyApps()) if (!entries.some((entry) => entry.id === app.id)) entries.push({ ...app, keywords: firstPartyKeywords(app.id) });
  const seen = new Set(entries.map((entry) => entry.id));
  const roots = iconRoots();
  for (const dir of dataDirs()) {
    // The first folder with an id has it (the person's own over the system's), as the specification says.
    for (const { id, path } of desktopFiles(join(dir, "applications"))) {
      if (seen.has(id)) continue;
      seen.add(id);
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      const parsed = parseDesktopEntry(id, text);
      if (!parsed || (parsed.hidden && !options.withHidden)) continue;
      const { iconName, ...entry } = parsed;
      const runnable = launchable(entry);
      if (runnable) entries.push({ ...runnable, icon: cachedIcon(iconName, roots) });
    }
  }
  return withDistinctNames(entries, options.nameOf);
}
