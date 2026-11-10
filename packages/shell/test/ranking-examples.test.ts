import { describe, expect, test } from "bun:test";
import { SETTINGS_APP_ID, SETUP_APP_ID } from "../src/apps.ts";
import { rank, rankEntries } from "../src/launcher/ranking/index.ts";
import { ENTRIES, index } from "./ranking-fixture.ts";

const INDEX = index();
const names = (query: string, limit = 7): string[] => rankEntries(INDEX, query, undefined, limit).map((entry) => entry.name);
const first = (query: string): string | undefined => names(query)[0];

describe("the reports' examples", () => {
  // Each row: what was typed, what comes first.
  const First: Array<[string, string]> = [
    ["set", "System Settings"],
    ["sett", "System Settings"],
    ["settings", "System Settings"],
    ["Settings", "System Settings"],
    ["preferences", "System Settings"],
    ["control panel", "System Settings"],
    ["ss", "System Settings"],
    ["sys", "System Settings"],
    ["setup", "Setup Assistant"],
    ["welcome", "Setup Assistant"],
    ["first run", "Setup Assistant"],
    ["ter", "Terminal"],
    ["term", "Terminal"],
    ["wif", "Wi-Fi"],
    ["wifi", "Wi-Fi"],
    ["wi fi", "Wi-Fi"],
    ["wi-fi", "Wi-Fi"],
    ["dark mode", "Appearance"],
    ["dark", "Appearance"],
    ["display", "Displays"],
    ["language", "Language & Region"],
    ["fierfox", "Firefox"],
    ["firefx", "Firefox"],
    ["firefox", "Firefox"],
    ["fire", "Firefox"],
    ["browser", "Firefox"],
    ["vsc", "Visual Studio Code"],
    ["msg", "Messages"],
    ["tedit", "Text Editor"],
    ["files", "Files"],
    ["calc", "Calculator"],
    ["tery", "Battery & Power"],
  ];
  for (const [query, expected] of First) test(`"${query}" finds ${expected} first`, () => expect(first(query)).toBe(expected));

  test('"ter" no longer finds Battery & Power: a bare substring inside a word counts from four letters', () => {
    expect(names("ter")).not.toContain("Battery & Power");
    expect(names("tery")).toContain("Battery & Power");
  });

  test('"set" puts the Setup Assistant last, under everything it ties with', () => {
    const found = names("set", 50);
    expect(found[0]).toBe("System Settings");
    expect(found.at(-1)).toBe("Setup Assistant");
  });

  test('"settings" is System Settings, not seven panes', () => {
    const found = rankEntries(INDEX, "settings", undefined, 50);
    expect(found[0]?.id).toBe(SETTINGS_APP_ID);
    expect(found.filter((entry) => entry.id.startsWith(`${SETTINGS_APP_ID}/`))).toEqual([]);
  });

  test('a pane answers "settings" when nothing else does', () => {
    const panesOnly = index(ENTRIES.filter((entry) => entry.id !== SETTINGS_APP_ID && entry.id !== SETUP_APP_ID));
    expect(rankEntries(panesOnly, "settings", undefined, 50).length).toBeGreaterThan(5);
  });

  test("the Setup Assistant answers to its intents, not to the shell's generic words", () => {
    expect(names("language", 50)).not.toContain("Setup Assistant");
    expect(names("preferences", 50)).not.toContain("Setup Assistant");
    expect(names("region", 50)).not.toContain("Setup Assistant");
  });

  test('"mode" reaches "dark mode" inside a multi-word keyword', () => {
    expect(names("mode")).toContain("Appearance");
  });

  test("a typo is reported as one, so the launcher can ask Did you mean", () => {
    const [hit] = rank(INDEX, "fierfox");
    expect(hit?.match).toBe("typo");
    expect(rank(INDEX, "firefox")[0]?.match).toBe("exact");
  });

  test("a typo is forgiven only from four letters", () => {
    expect(rank(INDEX, "fier").find((hit) => hit.item.id === "org.mozilla.firefox")?.match).toBe("typo");
    expect(names("fri")).not.toContain("Firefox");
  });

  test("an exact name beats a keyword, a prefix, and everything else", () => {
    expect(rank(INDEX, "notes")[0]?.match).toBe("exact");
    expect(first("text")).toBe("Text Editor");
  });

  test("nothing to match finds nothing", () => {
    expect(names("")).toEqual([]);
    expect(names("  ")).toEqual([]);
    expect(names("+-")).toEqual([]);
    expect(names("zzqx")).toEqual([]);
  });

  test("the limit holds, and keeps exactly the best of the full ranking", () => {
    expect(names("s", 3)).toHaveLength(3);
    for (const query of ["s", "t", "se", "fi", "mode", "fierfox", "a"]) {
      const all = rank(INDEX, query).map((hit) => hit.item.id);
      expect(rank(INDEX, query, { limit: 5 }).map((hit) => hit.item.id)).toEqual(all.slice(0, 5));
    }
  });
});

describe("languages", () => {
  test('"ecran" finds Displays for a French speaker, and the English words still match', () => {
    const french = index(ENTRIES, { LANG: "fr_FR.UTF-8" });
    expect(rankEntries(french, "ecran")[0]?.name).toBe("Displays");
    expect(rankEntries(french, "écran")[0]?.name).toBe("Displays");
    expect(rankEntries(french, "display")[0]?.name).toBe("Displays");
    expect(rankEntries(french, "parametres")[0]?.name).toBe("System Settings");
  });

  test("a German speaker finds Sound by Lautstärke, typed with or without the umlaut", () => {
    const german = index(ENTRIES, { LANG: "de_DE.UTF-8" });
    expect(rankEntries(german, "lautstarke")[0]?.name).toBe("Sound");
    expect(rankEntries(german, "einstellungen")[0]?.name).toBe("System Settings");
    // English isn't spoken there: no German words leak into another language's index.
    expect(rankEntries(INDEX, "lautstarke")).toEqual([]);
  });

  test("an app's localized name is found, and its English one", () => {
    const localized = index([
      ...ENTRIES,
      { id: "org.example.Screen", name: "Screen Tool", icon: "", keywords: [], localized: { name: "Écran", keywords: ["moniteur"] } },
    ]);
    expect(rankEntries(localized, "ecran")[0]?.id).toBe("org.example.Screen");
    expect(rankEntries(localized, "screen tool")[0]?.id).toBe("org.example.Screen");
    expect(rankEntries(localized, "moniteur")[0]?.id).toBe("org.example.Screen");
  });
});
