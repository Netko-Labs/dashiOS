import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeys, type IndexApplet, type KeyPair, readInstalled, sign } from "@dashi/applet";
import { applyKillSwitch } from "../src/applet-store/kill-switch.ts";
import { CatalogSet } from "../src/shared/applet-store/catalog-set.ts";
import type { CatalogSetting, CatalogSource } from "../src/shared/applet-store/catalogs.ts";
import { AppletInstaller, statusOf } from "../src/shared/applet-store/installer.ts";
import { storeEntries } from "../src/shared/applet-store/merge.ts";
import { author, DASHI, dashiKey, dashiSource, entry, indexOf, line, teamKey } from "./support/applet-catalogs.ts";

/** An index on disk, signed with `signer`, its packages beside it: a file:// catalog. */
function onDisk(signer: KeyPair, applets: (dir: string) => IndexApplet[]): { url: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "dashi-catalog-"));
  const bytes = new TextEncoder().encode(JSON.stringify({ format: 1, generated: "2026-11-05T00:00:00Z", applets: applets(dir) }));
  writeFileSync(join(dir, "index.json"), bytes);
  writeFileSync(join(dir, "index.json.minisig"), sign(bytes, signer.secretKey, "timestamp:1 file:index.json"));
  return { url: `file://${join(dir, "index.json")}`, dir };
}

test("adding a catalog checks its index with the key given before anything is saved", async () => {
  const good = onDisk(teamKey, () => [entry("dev.team.only")]);
  let saved: CatalogSetting[] = [];
  const set = new CatalogSet({
    dashi: { ...dashiSource, key: null },
    cacheDir: mkdtempSync(join(tmpdir(), "dashi-store-cache-")),
    saved: {
      read: () => saved,
      write: (list) => {
        saved = [...list];
        return null;
      },
    },
  });
  // Signed by someone else than the key given: refused, said plainly, nothing kept.
  const forged = onDisk(generateKeys(), () => [entry("dev.team.only")]);
  const refused = await set.add({ name: "Team", url: forged.url, key: teamKey.publicKey });
  expect(refused).toBe("That catalog isn’t signed with this key, so Dashi won’t trust it. Check the public key you were given.");
  expect(refused).not.toContain("dev.team");
  expect(saved).toEqual([]);
  // Nothing there at all.
  expect(await set.add({ name: "Team", url: "file:///nowhere/index.json", key: teamKey.publicKey })).toMatch(/couldn’t reach/);
  // Signed, but not an index.
  const junk = mkdtempSync(join(tmpdir(), "dashi-catalog-"));
  writeFileSync(join(junk, "index.json"), "[]");
  writeFileSync(join(junk, "index.json.minisig"), sign(new TextEncoder().encode("[]"), teamKey.secretKey, "t"));
  expect(await set.add({ name: "Team", url: `file://${join(junk, "index.json")}`, key: line(teamKey) })).toBe("There’s no applet catalog at that address.");
  expect(saved).toEqual([]);

  expect(await set.add({ name: "Team", url: good.url, key: teamKey.publicKey })).toBeNull();
  expect(saved).toEqual([{ name: "Team", url: good.url, key: line(teamKey) }]);
  expect(await set.add({ name: "Again", url: good.url, key: teamKey.publicKey })).toBe("That catalog is already in the list.");
  const loads = await set.loadAll();
  expect(loads.map((load) => [load.source.name, load.problem, load.index?.applets.length ?? null])).toEqual([
    ["Dashi", "no-key", null],
    ["Team", null, 1],
  ]);
  expect(set.remove(good.url)).toBeNull();
  expect(saved).toEqual([]);
  expect(set.remove(DASHI)).toBeNull();
  expect(set.sources().map((source) => source.name)).toEqual(["Dashi"]);
});

/** Two catalogs on disk, both listing `dev.shared.one` (each signed by its own key), and an installer between them. */
function twoCatalogs(options: { dashiPulled?: string[]; teamPulled?: string[] } = {}) {
  const dashiTree = onDisk(dashiKey, (dir) => [entry("dev.shared.one", { dir, versions: ["0.1.0", "0.2.0"], pulled: options.dashiPulled ?? [] })]);
  const teamTree = onDisk(teamKey, (dir) => [entry("dev.shared.one", { dir, versions: ["0.1.0", "0.3.0"], pulled: options.teamPulled ?? [] })]);
  return { dashiTree, teamTree };
}

function setOf(trees: ReturnType<typeof twoCatalogs>, root: string) {
  const saved: CatalogSetting[] = [{ name: "Team", url: trees.teamTree.url, key: line(teamKey) }];
  const set = new CatalogSet({
    dashi: { name: "Dashi", url: trees.dashiTree.url, key: line(dashiKey), builtIn: true },
    cacheDir: mkdtempSync(join(tmpdir(), "dashi-store-cache-")),
    saved: { read: () => saved, write: () => null },
  });
  const installer = new AppletInstaller({
    root,
    dataRoot: join(root, "..", "data"),
    dashiVersion: "0.4.0",
    dashiCatalog: trees.dashiTree.url,
    download: (url, size, catalog) => set.download(url, size, catalog),
  });
  return { set, installer };
}

test("an installed applet updates only from the catalog it came from, with the key it was verified with", async () => {
  const trees = twoCatalogs();
  const root = mkdtempSync(join(tmpdir(), "dashi-applets-"));
  const { set, installer } = setOf(trees, root);
  const loads = await set.loadAll();
  const [fromDashi, fromTeam] = loads.map((load) => storeEntries(load.index ?? indexOf([]), load.source)[0]);
  if (!fromDashi || !fromTeam) throw new Error("both entries");
  await installer.install(fromTeam, []);
  const [installed] = readInstalled(root);
  expect(installed?.record).toMatchObject({ version: "0.3.0", catalog: trees.teamTree.url, authorKey: line(author) });
  // Dashi's catalog lists the same id: it is installed (from Team), never an update or a pull from Dashi's.
  expect(statusOf(fromDashi, readInstalled(root), "0.4.0", trees.dashiTree.url).kind).toBe("installed");
  await expect(installer.install(fromDashi, [])).rejects.toThrow(/another catalog/);
  expect(readInstalled(root)[0]?.record.version).toBe("0.3.0");
  // Its catalog removed: no updates from anywhere, and no package from it either.
  await expect(set.download(fromTeam.versions[0]?.url ?? "", 10, "file:///gone/index.json")).rejects.toThrow(/removed/);
});

test("the kill switch: each installed applet answers to its own catalog's pulled list", async () => {
  const trees = twoCatalogs({ dashiPulled: ["0.2.0"], teamPulled: ["0.1.0"] });
  const dashiRoot = mkdtempSync(join(tmpdir(), "dashi-applets-"));
  const teamRoot = mkdtempSync(join(tmpdir(), "dashi-applets-"));
  // Installed before the pulls: 0.2.0 from Dashi's in one home, 0.3.0 from Team's in the other.
  const before = twoCatalogs();
  for (const [root, which] of [
    [dashiRoot, 0],
    [teamRoot, 1],
  ] as const) {
    const { set, installer } = setOf(before, root);
    const load = (await set.loadAll())[which];
    const target = load?.index ? storeEntries(load.index, load.source)[0] : undefined;
    if (!target) throw new Error("an entry");
    await installer.install(target, []);
  }
  // Now the catalogs pull: Dashi's its 0.2.0 (installed in dashiRoot), Team's its 0.1.0 (not the installed 0.3.0).
  const retarget = (root: string) => {
    for (const applet of readInstalled(root)) {
      const record = JSON.parse(readFileSync(join(applet.dir, "install.json"), "utf8"));
      record.catalog = record.catalog === before.dashiTree.url ? trees.dashiTree.url : trees.teamTree.url;
      writeFileSync(join(applet.dir, "install.json"), JSON.stringify(record));
    }
  };
  retarget(dashiRoot);
  retarget(teamRoot);
  for (const root of [dashiRoot, teamRoot]) {
    const { set, installer } = setOf(trees, root);
    const catalogs = set.sources().map((source) => set.catalogFor(source));
    const off = await applyKillSwitch(catalogs, installer);
    expect(off).toEqual(root === dashiRoot ? ["dev.shared.one"] : []);
    expect(readInstalled(root)[0]?.record.disabled).toEqual(root === dashiRoot ? { reason: "pulled", detail: "breaks things" } : undefined);
  }
  // A pull in a catalog the applet didn't come from turns nothing off.
  const strict = twoCatalogs({ dashiPulled: ["0.3.0"] });
  const root = mkdtempSync(join(tmpdir(), "dashi-applets-"));
  const { set, installer } = setOf(strict, root);
  const team = (await set.loadAll())[1];
  const teamEntry = team?.index ? storeEntries(team.index, team.source)[0] : undefined;
  if (!teamEntry) throw new Error("an entry");
  await installer.install(teamEntry, []);
  expect(await applyKillSwitch([set.catalogFor(set.sources()[0] as CatalogSource)], installer)).toEqual([]);
  expect(existsSync(join(root, "dev.shared.one"))).toBe(true);
  expect(readInstalled(root)[0]?.record.disabled).toBeUndefined();
});
