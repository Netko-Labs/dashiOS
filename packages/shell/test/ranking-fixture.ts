/** The launcher's entries as the shell builds them (entries.ts loadEntries), for the ranking tests. */

import { SETTINGS_APP_ID, SETUP_APP_ID } from "../src/apps.ts";
import type { Entry } from "../src/entries.ts";
import { entryItem } from "../src/launcher/ranking/entries.ts";
import { entryIndex, type RankItem } from "../src/launcher/ranking/index.ts";
import { paneEntry, paneKeywords } from "../src/settings-app/search.ts";
import { PANES } from "../src/shared/settings/panes.ts";

const app = (id: string, name: string, keywords: string[] = [], extra: Partial<Entry> = {}): Entry => ({ id, name, icon: "", keywords, ...extra });

/** The shell's own words today (entries.ts SHELL_KEYWORDS, OWN_KEYWORDS). */
const SHELL = ["settings", "preferences", "system", "options", "configuration"];

export const ENTRIES: Entry[] = [
  app("dev.dashi.terminal", "Terminal", ["foot", "shell", "console", "command line", "prompt"]),
  app("dev.dashi.files", "Files", ["file manager", "folders", "explorer"]),
  app("org.gnome.Nautilus", "Files (Nautilus)", ["folder", "manager", "explore", "disk", "filesystem", "file manager"]),
  app("dev.dashi.editor", "Text Editor", ["text", "editor", "plain text", "notepad"]),
  app("dev.dashi.notes", "Notes", ["notepad", "memo", "markdown", "todo"]),
  app("dev.dashi.calculator", "Calculator", ["calc", "math", "arithmetic"]),
  app("org.mozilla.firefox", "Firefox", ["internet", "www", "browser", "web", "explorer", "web browser"]),
  app("org.gnome.Messages", "Messages", ["sms", "chat", "text"]),
  app("code", "Visual Studio Code", ["vscode", "development", "programming"]),
  app("org.gnome.DejaDup", "Backups", ["backup", "restore", "snapshot", "deja dup"]),
  app(SETTINGS_APP_ID, "System Settings", [...SHELL, "dev.dashi.settings"], { shell: true }),
  app(SETUP_APP_ID, "Setup Assistant", [...SHELL, "setup", "assistant", "welcome", "first run", "language", "region", "time zone", "dev.dashi.setup"], {
    shell: true,
  }),
  // As settings-app/search.ts registers them: "settings" only when nothing else answers (paneLook).
  ...PANES.map((pane): Entry => ({ ...paneEntry(pane), keywords: paneKeywords(pane), fallbackKeywords: ["settings"], shell: true })),
];

export const index = (entries: readonly Entry[] = ENTRIES, env: Record<string, string> = { LANG: "en_US.UTF-8" }) => entryIndex(entries, env);

export const WORDS = (
  "new open save close print export import undo redo cut copy paste select find replace zoom view window tab " +
  "document file folder project image photo video music track album playlist note task calendar event mail message " +
  "contact account settings preferences format bold italic underline align left right center insert table chart " +
  "layer filter effect color brush pencil eraser shape text font size spacing margin page section header footer " +
  "branch commit merge rebase build debug run test deploy terminal console server database query report invoice " +
  "budget expense income transfer backup restore sync share upload download history bookmark reader library search"
).split(" ");

/** A small deterministic generator, so the index is the same every run. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** `count` items like the launcher's index will hold: these entries, 150 apps, 60 windows, menu rows for the rest. */
export function syntheticItems(count: number): RankItem[] {
  const random = generator(42);
  const word = () => WORDS[Math.floor(random() * WORDS.length)] as string;
  const title = (words: number) => Array.from({ length: words }, () => word().replace(/^./, (c) => c.toUpperCase())).join(" ");
  const out: RankItem[] = ENTRIES.map((entry) => entryItem(entry, []));
  const apps = Array.from({ length: 150 }, (_, i) => ({
    id: `app-${i}`,
    kind: "app" as const,
    names: [title(1 + (i % 3))],
    keywords: [word(), word(), `${word()} ${word()}`],
  }));
  out.push(...apps);
  for (let i = 0; i < 60; i++) out.push({ id: `window-${i}`, kind: "window", names: [`${title(3)} — ${apps[i]?.names[0]}`], foreign: true });
  for (let i = 0; out.length < count; i++) {
    const app = apps[i % apps.length] as RankItem;
    out.push({ id: `menu-${i}`, kind: "menu", names: [title(1 + (i % 3))], keywords: [app.names[0] as string, title(1)] });
  }
  return out;
}
