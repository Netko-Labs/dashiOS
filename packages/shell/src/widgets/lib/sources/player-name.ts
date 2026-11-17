/**
 * A player's name as a person knows it: the Name in its desktop entry (the
 * root interface's `DesktopEntry`), else its `Identity`, else its bus name
 * without the MPRIS prefix and the instance number ("chromium.instance362824"
 * is "Chromium"). Pass 49 saw the bus name on a paused Music card.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDirs, desktopFields } from "../../../shared/apps/index.ts";

const PREFIX = "org.mpris.MediaPlayer2.";

export interface PlayerFacts {
  bus: string;
  identity: string;
  desktopEntry: string;
}

/** The bus name, cleaned: no prefix, no ".instance123", the first letter a capital. */
export function busWord(bus: string): string {
  const word =
    (bus.startsWith(PREFIX) ? bus.slice(PREFIX.length) : bus)
      .replace(/\.instance_?\d+$/, "")
      .split(".")
      .at(-1) ?? "";
  return word === "" ? "Player" : word.charAt(0).toUpperCase() + word.slice(1);
}

export function playerName(facts: PlayerFacts, entryName: (id: string) => string | null = desktopName): string {
  const entry = facts.desktopEntry.trim();
  return (entry ? entryName(entry) : null) ?? (facts.identity.trim() || busWord(facts.bus));
}

/** The Name of the desktop entry `id` (with or without ".desktop"), from the first data folder that has it. */
export function desktopName(id: string, dirs: readonly string[] = dataDirs()): string | null {
  const file = id.endsWith(".desktop") ? id : `${id}.desktop`;
  if (file.includes("/")) return null;
  for (const dir of dirs) {
    try {
      const name = desktopFields(readFileSync(join(dir, "applications", file), "utf8")).get("Name");
      if (name) return name;
    } catch {
      // Not in this folder.
    }
  }
  return null;
}
