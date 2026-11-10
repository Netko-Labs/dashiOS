import { describe, expect, test } from "bun:test";
import { commandActions } from "../src/actions/sources/commands.ts";
import { settingsActions } from "../src/actions/sources/settings.ts";
import { registerShellApp, SCREENSHOT_APP_ID } from "../src/apps.ts";
import { clipboardActions } from "../src/clipboard/actions.ts";
import { SNIPPETS_ADDRESS } from "../src/clipboard/scope.ts";
import { shellEntries } from "../src/entries.ts";
import { KEYMAP } from "../src/keymap.ts";
import { launcherIndex } from "../src/launcher/items.ts";
import type { RankSignals } from "../src/launcher/ranking/item.ts";
import { buildSections, found, type ListInput, selectable } from "../src/launcher/rows.ts";
import { app, list } from "./support/launcher-fixtures.ts";

describe("did you mean", () => {
  test("the ranking's typos, from four letters, only when nothing else matched", () => {
    const entries = [app("Firefox"), app("Terminal"), app("Hidden", { hidden: true })];
    const suggestion = (query: string) => found(list({ query, entries }), 5).suggestion?.entry?.name ?? null;
    expect(suggestion("fierfox")).toBe("Firefox");
    // Letters in order from a word start are a match of their own, not a typo.
    expect(found(list({ query: "termnal", entries }), 5).items.map((item) => item.entry?.name)).toEqual(["Terminal"]);
    expect(suggestion("fir")).toBeNull();
    expect(suggestion("hiden")).toBeNull();
    // A typo is never a result of its own.
    expect(found(list({ query: "fierfox", entries }), 5).items).toEqual([]);
  });

  test("only a single word that looks like a misspelt name: never a sentence on its way, nor a keyword one letter off", () => {
    const index = launcherIndex({
      entries: [app("Firefox", { keywords: ["browser"] })],
      actions: commandActions(async () => {}, KEYMAP),
    });
    const suggested = (query: string) => {
      const item = found(list({ query, index }), 5).suggestion;
      return item?.entry?.name ?? item?.action?.title ?? null;
    };
    // The VM run: "turn on" (Shut Down's "turn off", one letter off) asked "Did you mean Shut Down…?".
    expect(suggested("turn on")).toBeNull();
    expect(suggested("turn on the wifi")).toBeNull();
    expect(suggested("brwoser")).toBeNull();
    expect(suggested("fierfox")).toBe("Firefox");
    expect(suggested("restrat")).toBe("Restart…");
    const titles = buildSections(list({ query: "turn on", index, entries: [app("Files", { id: "dev.dashi.files" })] }))
      .flatMap((section) => section.rows)
      .map((row) => row.title);
    expect(titles.some((title) => title.startsWith("Did you mean"))).toBe(false);
  });
});

describe("screenshots", () => {
  test("the words people take a screenshot by find Screenshot… first, with its key", () => {
    const index = launcherIndex({
      entries: [],
      actions: commandActions(
        async () => {},
        KEYMAP,
        async () => {},
      ),
    });
    const firstCommand = (query: string) => found(list({ query, index }), 5).items.find((item) => item.action)?.action;
    for (const query of ["screenshot", "screen shot", "print screen", "Screenshot", "record screen", "snip"]) {
      expect([query, firstCommand(query)?.title]).toEqual([query, "Screenshot…"]);
    }
    expect(firstCommand("screenshot")?.shortcut).toBe("⇧❖5");
    // The other two come with it.
    const titles = found(list({ query: "screenshot", index }), 5).items.map((item) => item.action?.title);
    expect(titles).toContain("Screenshot of the Screen");
    expect(titles).toContain("Screenshot of an Area…");
  });

  // Everything the VM's launcher holds that answers to these words: the settings and the clipboard's Snippets too.
  const everything = () =>
    launcherIndex({
      entries: [],
      actions: [
        ...commandActions(
          async () => {},
          KEYMAP,
          async () => {},
        ),
        ...settingsActions({ state: () => null as never, open: () => {} }),
        ...clipboardActions({ open: () => {}, enabled: () => true, setEnabled: () => {}, count: () => 0, clear: () => {}, confirm: async () => false }),
      ],
    });
  const titlesOf = (query: string, input: Partial<ListInput> = {}) =>
    selectable(buildSections(list({ query, index: everything(), ...input }))).map((row) => row.title);

  test("“snip” is Screenshot…, even after Snippets was opened and picked for “snip”", () => {
    const signals: RankSignals = {
      picks: (query) => new Map(query === "snip" ? [[SNIPPETS_ADDRESS, 1]] : []),
      frecency: (id) => (id === SNIPPETS_ADDRESS ? 6 : 0),
    };
    expect(titlesOf("snip", { signals })[0]).toBe("Screenshot…");
    expect(titlesOf("snip")[0]).toBe("Screenshot…");
  });

  test("the three screenshots stay together, before the Settings row that answers to the word", () => {
    expect(titlesOf("screenshot")).toEqual(["Screenshot…", "Screenshot of an Area…", "Screenshot of the Screen", "Apps' permissions"]);
  });

  test("with the Screenshot app installed, it is the one row for the toolbar, first for the words people use", () => {
    const stop = registerShellApp(SCREENSHOT_APP_ID, () => {});
    try {
      const screenshotApp = shellEntries().find((entry) => entry.id === SCREENSHOT_APP_ID);
      expect(screenshotApp?.name).toBe("Screenshot");
      const index = launcherIndex({
        entries: screenshotApp ? [screenshotApp] : [],
        actions: [
          ...commandActions(
            async () => {},
            KEYMAP,
            async () => {},
          ),
          ...clipboardActions({ open: () => {}, enabled: () => true, setEnabled: () => {}, count: () => 0, clear: () => {}, confirm: async () => false }),
        ],
      });
      const titles = (query: string) => selectable(buildSections(list({ query, index }))).map((row) => row.title);
      for (const query of ["screenshot", "snip", "print screen", "record screen"]) expect([query, titles(query)[0]]).toEqual([query, "Screenshot"]);
      expect(titles("screenshot")).not.toContain("Screenshot…");
      expect(titles("screenshot")).toContain("Screenshot of an Area…");
    } finally {
      stop();
    }
  });
});
