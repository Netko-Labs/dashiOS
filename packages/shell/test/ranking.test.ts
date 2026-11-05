import { describe, expect, test } from "bun:test";
import { SETTINGS_APP_ID, SETUP_APP_ID } from "../src/apps.ts";
import { buildIndex, fold, prepare, rank, rankEntries } from "../src/launcher/ranking/index.ts";
import { fuzzyScore, withinOneEdit } from "../src/launcher/ranking/match.ts";
import { ENTRIES, index } from "./ranking-fixture.ts";

const INDEX = index();
const names = (query: string, limit = 7): string[] => rankEntries(INDEX, query, undefined, limit).map((entry) => entry.name);
const first = (query: string): string | undefined => names(query)[0];

describe("folding", () => {
  test("case and accents fold; letters that don't decompose are spelled out", () => {
    expect(fold("Écran")).toBe("ecran");
    expect(fold("Straße")).toBe("strasse");
    expect(fold("Ærø Łódź")).toBe("aero lodz");
  });

  test("words start at spaces, punctuation and camel case", () => {
    expect(prepare("System Settings")).toMatchObject({ text: "systemsettings", words: ["system", "settings"], initials: "ss" });
    expect(prepare("Wi-Fi").text).toBe("wifi");
    expect(prepare("GitHub Desktop").initials).toBe("ghd");
    expect(prepare("VSCode").words).toEqual(["vs", "code"]);
    expect(prepare("Battery & Power").words).toEqual(["battery", "power"]);
  });
});

describe("an app over a Settings pane that matches as well (the wave 1 VM run)", () => {
  const withApps = index([...ENTRIES, { id: "dev.dashi.activity-monitor", name: "Activity Monitor", icon: "", keywords: ["task manager", "processes"] }]);
  const top = (query: string): string | undefined => rankEntries(withApps, query, undefined, 3)[0]?.name;
  // Each row: what was typed, the Top hit, and the pane that used to take it.
  const Rows: Array<[string, string, string]> = [
    ["no", "Notes", "Notifications"],
    ["s", "System Settings", "Sound"],
    ["a", "Activity Monitor", "About"],
    ["b", "Backups", "Bluetooth"],
    ["n", "Notes", "Network"],
  ];
  for (const [query, expected, pane] of Rows) {
    test(`"${query}" is ${expected}, not ${pane}`, () => {
      const found = rankEntries(withApps, query, undefined, 10).map((entry) => entry.name);
      expect(found.indexOf(expected)).toBeLessThan(found.indexOf(pane));
      expect(top(query)).not.toBe(pane);
    });
  }

  test('a command or setting that matches as well as an app comes after it ("s" was Sleep in the VM)', () => {
    const items = buildIndex([
      { id: "dev.dashi.software", kind: "app", names: ["Software"] },
      { id: "dev.dashi.settings", kind: "app", names: ["System Settings"], own: true },
      { id: "dashi://dashi/sleep", kind: "command", names: ["Sleep"] },
      { id: "dashi://settings/sound/show-in-menu-bar", kind: "setting", names: ["Show Sound in menu bar"] },
    ]);
    const kinds = rank(items, "s").map((result) => result.item.kind);
    expect(kinds.slice(0, 2)).toEqual(["app", "app"]);
    expect(rank(items, "sleep")[0]?.item.id).toBe("dashi://dashi/sleep");
  });

  test("a pane is the Top hit when it is clearly the match: its whole name, or one of its words, or nothing else matches", () => {
    expect(top("sound")).toBe("Sound");
    expect(top("notifications")).toBe("Notifications");
    expect(top("wallpaper")).toBe("Wallpaper");
    expect(top("dnd")).toBe("Notifications");
    expect(top("wal")).toBe("Wallpaper");
  });
});

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
    ["wif", "Network"],
    ["wifi", "Network"],
    ["wi fi", "Network"],
    ["wi-fi", "Network"],
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

describe("kinds", () => {
  test("text another program chose never outranks an exact name, even picked", () => {
    const mixed = buildIndex([
      { id: "window", kind: "window", names: ["Terminal"], foreign: true },
      { id: "app", kind: "app", names: ["Terminal"] },
    ]);
    const signals = { picks: () => new Map([["window", 5]]), frecency: (id: string) => (id === "window" ? 100 : 0) };
    expect(rank(mixed, "terminal", { signals }).map((result) => result.item.id)).toEqual(["app", "window"]);
  });

  test("on a tie an app comes before a pane, a pane before a menu row", () => {
    const tied = buildIndex([
      { id: "menu", kind: "menu", names: ["Sound"] },
      { id: "pane", kind: "pane", names: ["Sound"] },
      { id: "app", kind: "app", names: ["Sound"] },
    ]);
    expect(rank(tied, "sound").map((result) => result.item.id)).toEqual(["app", "pane", "menu"]);
  });
});

describe("the matchers", () => {
  test("one edit: insertion, deletion, substitution, swap of neighbors", () => {
    expect(withinOneEdit("fierfox", "firefox")).toBe(true);
    expect(withinOneEdit("firefx", "firefox")).toBe(true);
    expect(withinOneEdit("firefoxx", "firefox")).toBe(true);
    expect(withinOneEdit("firefax", "firefox")).toBe(true);
    expect(withinOneEdit("fierfx", "firefox")).toBe(false);
    expect(withinOneEdit("abc", "abc")).toBe(true);
  });

  test("fuzzy starts at a word start and never jumps into a word's middle across words", () => {
    expect(fuzzyScore("ter", prepare("Battery & Power"))).toBeNull();
    expect(fuzzyScore("ter", prepare("Text Editor"))).toBeNull();
    expect(fuzzyScore("msg", prepare("Messages"))).not.toBeNull();
    expect(fuzzyScore("tedit", prepare("Text Editor"))).not.toBeNull();
    expect(fuzzyScore("sset", prepare("System Settings"))).not.toBeNull();
  });

  test("three letters spread through one word only as an abbreviation: a word is looked for as itself", () => {
    expect(fuzzyScore("tea", prepare("Terminal"))).toBeNull();
    expect(fuzzyScore("trm", prepare("Terminal"))).not.toBeNull();
  });
});
