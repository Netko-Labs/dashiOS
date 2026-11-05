import { afterAll, beforeAll, expect, test } from "bun:test";
import { registerShellApp, SETTINGS_APP_ID, SETUP_APP_ID } from "../src/apps.ts";
import { type Entry, parseDesktopEntry, search, shellEntries } from "../src/entries.ts";
import { PANES } from "../src/settings-app/panes.ts";
import { registerPaneEntries } from "../src/settings-app/search.ts";

// Today's ranking (entries.ts search), with the shell's real entries: System
// Settings, the Setup Assistant, and every Settings pane, as the shell
// registers them, beside a few installed apps.

const desktop = (id: string, text: string): Entry => {
  const parsed = parseDesktopEntry(id, `[Desktop Entry]\nType=Application\n${text}`);
  if (!parsed) throw new Error(`${id} did not parse`);
  const { iconName, ...rest } = parsed;
  return { ...rest, icon: iconName };
};

const undo: Array<() => void> = [];
let entries: Entry[] = [];

beforeAll(() => {
  undo.push(
    registerShellApp(SETTINGS_APP_ID, () => {}),
    registerShellApp(SETUP_APP_ID, () => {}),
    registerPaneEntries(() => {}),
  );
  entries = [
    { id: "dev.dashi.terminal", name: "Terminal", icon: "", keywords: ["dev.dashi.terminal"] },
    ...shellEntries(),
    desktop("org.mozilla.firefox", "Name=Firefox\nGenericName=Web Browser\nKeywords=Internet;WWW;\nExec=firefox %u"),
    desktop("org.gnome.Characters", "Name=Characters\nExec=gnome-characters"),
  ];
});

afterAll(() => {
  for (const each of undo) each();
});

const names = (query: string, limit = 7): string[] => search(entries, query, limit).map((entry) => entry.name);

test("every pane is in the index with its own glyph and what it holds", () => {
  const panes = entries.filter((entry) => entry.id.startsWith(`${SETTINGS_APP_ID}/`));
  expect(panes).toHaveLength(PANES.length);
  for (const pane of panes) {
    const info = PANES.find((each) => `${SETTINGS_APP_ID}/${each.id}` === pane.id);
    expect(pane.glyph).toBe(info?.glyph as string);
    expect(pane.detail?.length).toBeGreaterThan(0);
  }
});

test('"settings", "preferences" and "control panel" find System Settings first, and no pane', () => {
  for (const query of ["settings", "preferences", "control panel", "Settings "]) {
    expect(names(query)).toEqual(["System Settings"]);
  }
});

test('"set" puts System Settings above the Setup Assistant', () => {
  const found = names("set");
  expect(found[0]).toBe("System Settings");
  expect(found.at(-1)).toBe("Setup Assistant");
});

test('the Setup Assistant answers to "setup", "welcome" and "first run", and not to language or region', () => {
  for (const query of ["setup", "welcome", "first run"]) expect(names(query)[0]).toBe("Setup Assistant");
  expect(names("language")).not.toContain("Setup Assistant");
  expect(names("region")).not.toContain("Setup Assistant");
  expect(names("preferences")).not.toContain("Setup Assistant");
});

test('a pane answers to "settings" only when nothing else does', () => {
  const withoutSettings = entries.filter((entry) => entry.id !== SETTINGS_APP_ID);
  const found = search(withoutSettings, "settings", 30).map((entry) => entry.name);
  expect(found).toContain("Appearance");
  expect(found).not.toContain("Setup Assistant");
});

test('no bare in-word match under four letters: "ter" is Terminal, not Battery & Power or Characters', () => {
  expect(names("ter")).toEqual(["Terminal"]);
  // From four letters a match inside a word counts: "ract" is in Characters.
  expect(names("ract")).toEqual(["Characters"]);
});

test("exact name, then keyword, then prefix, word start and keyword prefix", () => {
  expect(names("firefox")[0]).toBe("Firefox");
  expect(names("web browser")[0]).toBe("Firefox");
  expect(names("fire")[0]).toBe("Firefox");
  expect(names("power")[0]).toBe("Battery & Power");
  expect(names("wif")).toEqual(["Network"]);
  expect(names("dark mode")).toEqual(["Appearance"]);
});

test("ties go to the shell, then A to Z", () => {
  const ties = names("d");
  expect(ties.indexOf("Date & Time")).toBeLessThan(ties.indexOf("Desktop & Dock"));
});

test("an installed app's generic name is what it is, after its name", () => {
  expect(entries.find((entry) => entry.id === "org.mozilla.firefox")?.detail).toBe("Web Browser");
  expect(desktop("foo", "Name=Terminal\nGenericName=Terminal\nExec=foo").detail).toBeUndefined();
});
