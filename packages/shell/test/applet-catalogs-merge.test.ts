import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IndexApplet } from "@dashi/applet";
import { CATALOG_HOSTS, Catalog, hostsFor } from "../src/shared/applet-store/catalog.ts";
import { allowedFor, type CatalogSource } from "../src/shared/applet-store/catalogs.ts";
import { type CatalogLoad, entryFromItsCatalog, mergeCatalogs, storeEntries } from "../src/shared/applet-store/merge.ts";
import { DASHI, dashiSource, entry, indexOf, line, TEAM, teamKey, teamSource } from "./support/applet-catalogs.ts";

const loaded = (source: CatalogSource, applets: IndexApplet[]): CatalogLoad => ({ source, index: indexOf(applets), stale: false, problem: null });

test("a catalog's files come from Dashi's hosts or its index's own, https only; a local file only for a local catalog", async () => {
  expect(hostsFor(DASHI)).toEqual([...CATALOG_HOSTS]);
  expect(hostsFor(TEAM)).toEqual([...CATALOG_HOSTS, "applets.example.com"]);
  expect(allowedFor(TEAM, "https://applets.example.com/team/a.dashi-applet")).toBe(true);
  expect(allowedFor(TEAM, "https://github.com/alexk/a/releases/download/a.dashi-applet")).toBe(true);
  expect(allowedFor(TEAM, "https://evil.example.net/a.dashi-applet")).toBe(false);
  expect(allowedFor(TEAM, "http://applets.example.com/a.dashi-applet")).toBe(false);
  expect(allowedFor(DASHI, "https://applets.example.com/a.dashi-applet")).toBe(false);
  expect(allowedFor(TEAM, "file:///etc/passwd")).toBe(false);
  expect(allowedFor("file:///tmp/catalog/index.json", "file:///tmp/catalog/a.dashi-applet")).toBe(true);

  // What the store lists: versions, icons and screenshots it may not fetch are left out; an applet with nothing left, too.
  const listed = storeEntries(
    indexOf([
      {
        ...entry("dev.alexk.mixed", { host: "applets.example.com" }),
        icon: "https://evil.example.net/icon.png",
        screenshots: ["https://applets.example.com/s.png"],
      },
      entry("dev.alexk.elsewhere", { host: "evil.example.net" }),
    ]),
    teamSource,
  );
  expect(listed.map((each) => each.manifest.id)).toEqual(["dev.alexk.mixed"]);
  expect(listed[0]).not.toHaveProperty("icon");
  expect(listed[0]?.screenshots).toEqual(["https://applets.example.com/s.png"]);

  // And downloading holds to it: an https catalog never reads a local file, nor another host.
  const fetched: string[] = [];
  const catalog = new Catalog({
    url: TEAM,
    key: line(teamKey),
    cacheDir: mkdtempSync(join(tmpdir(), "dashi-store-cache-")),
    fetch: async (url) => {
      fetched.push(url);
      return new Response("x");
    },
  });
  await expect(catalog.download("file:///etc/passwd", 10)).rejects.toThrow(/local file/);
  await expect(catalog.download("https://evil.example.net/a.dashi-applet", 10)).rejects.toThrow(/allowed host/);
  expect(await catalog.download("https://applets.example.com/a.dashi-applet", 10)).toEqual(new TextEncoder().encode("x"));
  expect(fetched).toEqual(["https://applets.example.com/a.dashi-applet"]);
});

test("one list: Dashi's wins a shared id, an added catalog's applets are never reviewed, an installed one follows its catalog", () => {
  const dashi = loaded(dashiSource, [entry("dev.shared.one"), entry("dev.dashi.only")]);
  const team = loaded(teamSource, [
    entry("dev.shared.one", { host: "applets.example.com" }),
    entry("dev.team.only", { host: "applets.example.com", reviewed: true }),
  ]);
  const merged = mergeCatalogs([dashi, team], [], DASHI);
  expect(merged.map((each) => `${each.manifest.id}@${each.from.name}`)).toEqual(["dev.shared.one@Dashi", "dev.dashi.only@Dashi", "dev.team.only@Team"]);
  expect(merged.find((each) => each.from.name === "Team")?.reviewed).toBe(false);
  expect(merged.find((each) => each.manifest.id === "dev.dashi.only")?.reviewed).toBe(true);

  const fromTeam = { manifest: { id: "dev.shared.one" }, record: { source: "catalog" as const, catalog: TEAM } };
  expect(mergeCatalogs([dashi, team], [fromTeam], DASHI).find((each) => each.manifest.id === "dev.shared.one")?.from.name).toBe("Team");
  expect(entryFromItsCatalog([dashi, team], fromTeam, DASHI)?.from.url).toBe(TEAM);
  // A record from before catalogs names none: it is Dashi's.
  expect(entryFromItsCatalog([dashi, team], { manifest: { id: "dev.shared.one" }, record: { source: "catalog" } }, DASHI)?.from.url).toBe(DASHI);
  // Its catalog removed: it has no entry, and the list shows Dashi's again.
  expect(entryFromItsCatalog([dashi], fromTeam, DASHI)).toBeUndefined();
  expect(mergeCatalogs([dashi], [fromTeam], DASHI).find((each) => each.manifest.id === "dev.shared.one")?.from.name).toBe("Dashi");
});
