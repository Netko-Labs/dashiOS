/**
 * The installed apps as identity.ts matches processes against them: Dashi's
 * own apps by their folder, every desktop entry (hidden ones too: they name
 * apps that keep a second entry) by its id, its window class, and the
 * program it runs. `catalogFrom` is pure; reading the entries (app-entries'
 * `readEntries`) takes a moment: Activity Monitor does it on its reader thread.
 */

import { type App, FIRST_PARTY, type FirstPartySpec, iconPath } from "../apps/index.ts";
import { type AppCatalog, type AppIdentity, programOf } from "./identity.ts";

/** Dashi itself, as a row: the compositor, the session, the shell. */
export const DASHI_KEY = "dev.dashi.shell";

/** What the catalog reads of an installed app's entry (entries.ts `Entry`). */
type CatalogEntry = Pick<App, "id" | "name" | "icon" | "exec"> & { wmClass?: string; hidden?: true };

export function catalogFrom(entries: readonly CatalogEntry[], firstParty: readonly FirstPartySpec[] = FIRST_PARTY): AppCatalog {
  const byProgram = new Map<string, AppIdentity>();
  const byId = new Map<string, AppIdentity>();
  const own = new Set(firstParty.map((spec) => spec.id));
  for (const entry of entries) {
    const identity: AppIdentity = { key: entry.id, name: entry.name, icon: entry.icon };
    for (const id of [entry.id, entry.wmClass]) if (id && !byId.has(id.toLowerCase())) byId.set(id.toLowerCase(), identity);
  }
  // Visible entries first. A hidden one names an app's windows, but when it runs its program with
  // options it is often a command-line tool's handler (`claude --handle-uri %u`), and that tool
  // isn't an app wherever it runs; one that runs the bare program is the app's (T3 Code's).
  const visible = entries.filter((entry) => !entry.hidden);
  const hidden = entries.filter((entry) => entry.hidden && entry.exec?.length === 1);
  for (const entry of [...visible, ...hidden]) {
    // Dashi's apps all run `bun main.tsx`: they are found by their folder instead.
    if (own.has(entry.id) || !entry.exec) continue;
    const program = programOf(entry.exec);
    if (program && !byProgram.has(program)) byProgram.set(program, { key: entry.id, name: entry.name, icon: entry.icon });
  }
  return {
    byProgram,
    byId,
    firstParty: new Map(firstParty.map((spec) => [spec.dir, { key: spec.id, name: spec.name, icon: iconPath(spec.icon) }])),
    // Dashi's own mark, the bowl, as Setup and a nested Dashi have it (apps.ts).
    dashi: { key: DASHI_KEY, name: "Dashi", icon: iconPath("setup") },
    genericIcon: iconPath("generic"),
  };
}
