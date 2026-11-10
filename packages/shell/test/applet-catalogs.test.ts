import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSettings } from "../src/settings.ts";
import { SettingsStore } from "../src/settings-app/store.ts";
import { readSavedCatalogs } from "../src/shared/applet-store/catalog-set.ts";
import { type CatalogSetting, catalogSources, checkDraft, isCatalogList, keyLineOf, parseCatalogs } from "../src/shared/applet-store/catalogs.ts";
import { DASHI, dashiSource, line, TEAM, teamKey } from "./support/applet-catalogs.ts";

test("applets.catalogs is read as untrusted, entry by entry", () => {
  const good = { name: "Team", url: TEAM, key: teamKey.publicKey };
  const { catalogs, problems } = parseCatalogs([
    good,
    { name: "Again", url: TEAM, key: line(teamKey) },
    { name: "Dashi's own", url: DASHI, key: line(teamKey) },
    { name: "", url: "https://a.example.com/index.json", key: line(teamKey) },
    { name: "Plain", url: "http://a.example.com/index.json", key: line(teamKey) },
    { name: "Port", url: "https://a.example.com:8443/index.json", key: line(teamKey) },
    { name: "Bad key", url: "https://b.example.com/index.json", key: "RWQnope" },
    { name: "Extra", url: "https://c.example.com/index.json", key: line(teamKey), trusted: true },
    "not an object",
  ]);
  // A .pub file's text is kept as its key's line.
  expect(catalogs).toEqual([{ name: "Team", url: TEAM, key: line(teamKey) }]);
  expect(problems).toHaveLength(8);
  expect(parseCatalogs({ name: "Team" }).problems).toEqual(["applets.catalogs must be a list"]);
  expect(parseCatalogs(undefined)).toEqual({ catalogs: [], problems: [] });
  expect(
    parseCatalogs(Array.from({ length: 20 }, (_, n) => ({ name: `C${n}`, url: `https://c${n}.example.com/index.json`, key: line(teamKey) }))).catalogs,
  ).toHaveLength(16);

  expect(isCatalogList([{ name: "Team", url: TEAM, key: line(teamKey) }])).toBe(true);
  expect(isCatalogList([{ name: "Team", url: TEAM, key: teamKey.publicKey }])).toBe(false);
  expect(isCatalogList([good, good])).toBe(false);
  expect(keyLineOf(`untrusted comment: minisign public key\n${line(teamKey)}\n`)).toBe(line(teamKey));
  expect(keyLineOf("RWQ not a key")).toBeNull();

  // The shell's reading of the file knows the section, and says what is wrong in it.
  expect(parseSettings({ applets: { catalogs: [good] } }).problems).toEqual([]);
  expect(parseSettings({ applets: { catalogs: [{ name: "x" }], other: 1 } }).problems).toEqual(
    expect.arrayContaining(["unknown setting applets.other", expect.stringContaining("applets.catalogs[0]")]),
  );
});

test("the settings store writes the list, keeps the rest of the file, and the store reads it back", () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-settings-"));
  const path = join(dir, "settings.json");
  writeFileSync(path, JSON.stringify({ dock: { autohide: true } }));
  const store = new SettingsStore(path, null);
  const list: CatalogSetting[] = [{ name: "Team", url: TEAM, key: line(teamKey) }];
  store.patch("applets", { catalogs: list });
  expect(store.getSnapshot().error).toBeNull();
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ dock: { autohide: true }, applets: { catalogs: list } });
  expect(readSavedCatalogs(path, DASHI).catalogs).toEqual(list);
  expect(() => store.patch("applets", { catalogs: [{ name: "Team", url: "http://x/index.json", key: "k" }] })).toThrow(TypeError);
  store.patch("applets", { catalogs: undefined });
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ dock: { autohide: true } });
  writeFileSync(path, "{ not json");
  expect(readSavedCatalogs(path, DASHI)).toEqual({ catalogs: [], problems: [] });
});

test("Dashi's catalog is first and can't be added again; what is typed is checked in people's words", () => {
  const sources = catalogSources(dashiSource, [{ name: "Team", url: TEAM, key: line(teamKey) }]);
  expect(sources.map((each) => [each.name, each.builtIn])).toEqual([
    ["Dashi", true],
    ["Team", false],
  ]);
  const draft = { name: "Other", url: "https://other.example.com/index.json", key: teamKey.publicKey };
  expect(checkDraft(draft, sources)).toEqual({ name: "Other", url: draft.url, key: line(teamKey) });
  expect(checkDraft({ ...draft, url: DASHI }, sources)).toEqual({ error: "That catalog is already in the list." });
  expect(checkDraft({ ...draft, url: TEAM }, sources)).toEqual({ error: "That catalog is already in the list." });
  expect(checkDraft({ ...draft, name: " " }, sources)).toEqual({ error: "Give the catalog a name." });
  expect(checkDraft({ ...draft, url: "http://other.example.com/index.json" }, sources)).toMatchObject({ error: expect.stringContaining("https://") });
  expect(checkDraft({ ...draft, key: "hello" }, sources)).toMatchObject({ error: expect.stringContaining("isn’t a public key") });
  expect(checkDraft({ ...draft, name: "team" }, sources)).toEqual({ error: "Another catalog already has that name." });
});
