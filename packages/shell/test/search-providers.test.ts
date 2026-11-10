import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMetas, providerSource, termsOf } from "../src/search-providers/lib/client.ts";
import { parseProviderIni, readProviders } from "../src/search-providers/lib/ini.ts";
import { SearchProviders } from "../src/search-providers/providers.ts";
import type { CallSpec } from "../src/shared/dbus/index.ts";
import { Variant } from "../src/shared/dbus/index.ts";

const CHARACTERS = [
  "[Shell Search Provider]",
  "DesktopId=org.gnome.Characters.desktop",
  "BusName=org.gnome.Characters.BackgroundService",
  "ObjectPath=/org/gnome/Characters/SearchProvider",
  "Version=2",
].join("\n");

test("a provider's key file: version 2 only, names checked, one off by default stays off", () => {
  expect(parseProviderIni(CHARACTERS)).toEqual({
    desktopId: "org.gnome.Characters",
    busName: "org.gnome.Characters.BackgroundService",
    objectPath: "/org/gnome/Characters/SearchProvider",
  });
  expect(parseProviderIni(CHARACTERS.replace("Version=2", "Version=1"))).toBeNull();
  expect(parseProviderIni(`${CHARACTERS}\nDefaultDisabled=true`)).toBeNull();
  expect(parseProviderIni(CHARACTERS.replace("/org/gnome/Characters/SearchProvider", "not a path"))).toBeNull();
  expect(parseProviderIni(CHARACTERS.replace("org.gnome.Characters.BackgroundService", "no"))).toBeNull();
  expect(parseProviderIni(CHARACTERS.replace("[Shell Search Provider]", "[Other]"))).toBeNull();
});

test("the data directories are read user first, a file name seen once", () => {
  const root = mkdtempSync(join(tmpdir(), "dashi-providers-"));
  try {
    for (const dir of ["user", "system"]) mkdirSync(join(root, dir, "gnome-shell/search-providers"), { recursive: true });
    writeFileSync(join(root, "user/gnome-shell/search-providers/org.gnome.Characters.search-provider.ini"), CHARACTERS);
    writeFileSync(join(root, "system/gnome-shell/search-providers/org.gnome.Characters.search-provider.ini"), CHARACTERS.replace("Version=2", "Version=1"));
    writeFileSync(join(root, "system/gnome-shell/search-providers/broken.ini"), "nonsense");
    const found = readProviders([join(root, "user"), join(root, "system"), join(root, "missing")]);
    expect(found.map((each) => each.desktopId)).toEqual(["org.gnome.Characters"]);
    const providers = new SearchProviders({ dirs: [join(root, "user")] });
    // Asked only while its app is installed.
    expect(providers.sources([])).toEqual([]);
    const entries = [{ id: "org.gnome.Characters", name: "Characters", icon: "/c.svg", keywords: [] }];
    expect(providers.sources(entries).map((each) => each.label)).toEqual(["Characters"]);
    expect(providers.sources(entries)).toBe(providers.sources(entries));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("metas: only the ids asked about, names cleaned, the wrong shape dropped", () => {
  const meta = (fields: Record<string, unknown>) => new Map(Object.entries(fields).map(([key, value]) => [key, new Variant("s", value)]));
  expect(
    parseMetas(
      [meta({ id: "é", name: "LATIN SMALL LETTER E WITH ACUTE", description: "U+00E9" }), meta({ id: "x", name: "not asked" }), meta({ id: "y" }), "junk"],
      ["é", "y"],
    ),
  ).toEqual([{ id: "é", name: "LATIN SMALL LETTER E WITH ACUTE", description: "U+00E9" }]);
  expect(parseMetas("junk", ["a"])).toEqual([]);
  expect(termsOf("  acute  e ")).toEqual(["acute", "e"]);
});

test("a provider as a slow source: its results, and Return opens the one chosen in its app", async () => {
  const calls: Array<Pick<CallSpec, "member" | "body">> = [];
  const bus = {
    call: async (spec: CallSpec): Promise<unknown[]> => {
      calls.push({ member: spec.member, body: spec.body });
      if (spec.member === "GetInitialResultSet") return [["a", "b", "c", "d"]];
      if (spec.member === "GetResultMetas")
        return [
          (spec.body?.[0] as string[]).map(
            (id) =>
              new Map([
                ["id", new Variant("s", id)],
                ["name", new Variant("s", `Result ${id}`)],
              ]),
          ),
        ];
      return [];
    },
  };
  const info = { desktopId: "org.gnome.Characters", busName: "org.gnome.Characters.BackgroundService", objectPath: "/org/gnome/Characters/SearchProvider" };
  const source = providerSource(info, { name: "Characters", icon: "/c.svg" }, async () => bus);
  expect(await source.ask("  ")).toEqual([]);
  const rows = await source.ask("acute e");
  expect(rows.map((row) => [row.id, row.title, row.icon])).toEqual([
    ["a", "Result a", "/c.svg"],
    ["b", "Result b", "/c.svg"],
    ["c", "Result c", "/c.svg"],
  ]);
  expect(await rows[1]?.run()).toEqual({ ok: true, text: "Result b is open in Characters." });
  expect(calls).toEqual([
    { member: "GetInitialResultSet", body: [["acute", "e"]] },
    { member: "GetResultMetas", body: [["a", "b", "c"]] },
    { member: "ActivateResult", body: ["b", ["acute", "e"], 0] },
  ]);
});
