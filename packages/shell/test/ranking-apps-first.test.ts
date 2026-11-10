import { describe, expect, test } from "bun:test";
import { buildIndex, rank, rankEntries } from "../src/launcher/ranking/index.ts";
import { ENTRIES, index } from "./ranking-fixture.ts";

describe("an app over a Settings pane that matches as well (the wave 1 VM run)", () => {
  const withApps = index([...ENTRIES, { id: "dev.dashi.activity-monitor", name: "Activity Monitor", icon: "", keywords: ["task manager", "processes"] }]);
  const top = (query: string): string | undefined => rankEntries(withApps, query, undefined, 3)[0]?.name;
  // Each row: what was typed, the Top hit, and the pane that used to take it.
  const Rows: Array<[string, string, string]> = [
    ["no", "Notes", "Notifications"],
    ["s", "System Settings", "Sound"],
    ["a", "Activity Monitor", "About"],
    ["b", "Backups", "Bluetooth"],
    ["n", "Notes", "Notifications"],
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

describe("menu rows and commands never outrank an app that matches as well (the wave 3 VM run)", () => {
  const items = buildIndex([
    { id: "dev.dashi.software", kind: "app", names: ["Software"] },
    { id: "dev.dashi.settings", kind: "app", names: ["System Settings"], own: true },
    { id: "dev.dashi.editor", kind: "app", names: ["Text Editor"] },
    { id: "dev.dashi.terminal", kind: "app", names: ["Terminal"] },
    { id: "dashi://clipboard/snippets", kind: "command", names: ["Snippets"], keywords: ["snippet", "text expansion"], own: true },
    { id: "dashi://dashi/sleep", kind: "command", names: ["Sleep"], own: true },
    { id: "dashi://script/say-hello", kind: "command", names: ["Say hello"], keywords: ["script"], foreign: true },
    { id: "dashi://menu/editor/file/save", kind: "menu", names: ["Save"], qualifiers: ["Text Editor", "File"], foreign: true },
    { id: "dashi://menu/editor/file/save-as", kind: "menu", names: ["Save As…"], qualifiers: ["Text Editor", "File"], foreign: true },
    { id: "dashi://menu/terminal/shell/new-tab", kind: "menu", names: ["New Tab"], qualifiers: ["Terminal", "Shell"], foreign: true },
  ]);
  /** Snippets, Save and New Tab picked often for every query below, and opened often: history can't lift them past an app. */
  const signals = {
    picks: () =>
      new Map([
        ["dashi://clipboard/snippets", 5],
        ["dashi://menu/editor/file/save", 5],
        ["dashi://menu/terminal/shell/new-tab", 5],
        ["dashi://dashi/sleep", 5],
      ]),
    frecency: (id: string) => (id.startsWith("dashi://") ? 50 : 0),
  };
  const top = (query: string, withHistory: boolean): string | undefined => rank(items, query, withHistory ? { signals } : {})[0]?.item.names[0];
  // Each row: what was typed, the Top hit, and the row that took it in the VM (or could, with history).
  const Rows: Array<[string, string, string]> = [
    ["s", "Software", "Snippets"],
    ["s", "Software", "Sleep"],
    ["say", "Say hello", "Save"],
    ["sn", "Snippets", "Software"],
    ["t", "Terminal", "New Tab"],
    ["te", "Terminal", "New Tab"],
    ["text", "Text Editor", "Snippets"],
    ["save", "Save", "Save As…"],
  ];
  for (const [query, expected, other] of Rows) {
    for (const history of [false, true]) {
      test(`"${query}" is ${expected}, not ${other}${history ? ", even with history" : ""}`, () => {
        expect(top(query, history)).toBe(expected);
        const found = rank(items, query, history ? { signals } : {}).map((result) => result.item.names[0]);
        if (found.includes(other)) expect(found.indexOf(expected)).toBeLessThan(found.indexOf(other));
      });
    }
  }

  test("history still lifts a command past an app that matches worse, and orders commands among themselves", () => {
    // "sn": Snippets is a prefix, System Settings ("s… s…") only its initials.
    expect(rank(items, "sn", { signals })[0]?.item.names[0]).toBe("Snippets");
    const commands = rank(items, "s", { signals }).filter((result) => result.item.kind !== "app");
    expect(commands[0]?.item.names[0]).not.toBe("Say hello");
  });

  test("the whole first word is closer than a word only begun", () => {
    const say = rank(items, "say")[0];
    expect(say?.item.names[0]).toBe("Say hello");
    expect(say?.match).toBe("prefix");
  });

  test("with a limit, the capped rows are the same as without", () => {
    for (const query of ["s", "sa", "t", "te"]) {
      const all = rank(items, query, { signals }).map((result) => result.item.id);
      expect(rank(items, query, { signals, limit: 3 }).map((result) => result.item.id)).toEqual(all.slice(0, 3));
    }
  });
});
