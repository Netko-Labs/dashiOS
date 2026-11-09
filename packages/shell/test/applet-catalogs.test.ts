import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CatalogIndex, generateKeys, type IndexApplet, type KeyPair, readInstalled, sha256, sign, trustedComment, writeTar } from "@dashi/applet";
import { CATALOG_HOSTS, Catalog, hostsFor } from "../src/applet-store/catalog.ts";
import { CatalogSet, readSavedCatalogs } from "../src/applet-store/catalog-set.ts";
import {
  allowedFor,
  type CatalogSetting,
  type CatalogSource,
  catalogSources,
  checkDraft,
  isCatalogList,
  keyLineOf,
  parseCatalogs,
} from "../src/applet-store/catalogs.ts";
import { AppletInstaller, statusOf } from "../src/applet-store/installer.ts";
import { applyKillSwitch } from "../src/applet-store/kill-switch.ts";
import { type CatalogLoad, entryFromItsCatalog, mergeCatalogs, storeEntries } from "../src/applet-store/merge.ts";
import { parseSettings } from "../src/settings.ts";
import { SettingsStore } from "../src/settings-app/store.ts";

// Throwaway keys for this run only.
const dashiKey = generateKeys();
const teamKey = generateKeys();
const author = generateKeys();
const line = (key: KeyPair): string => key.publicKey.split("\n")[1] ?? "";

const DASHI = "https://raw.githubusercontent.com/Netko-Labs/dashi-applets/index/index.json";
const TEAM = "https://applets.example.com/team/index.json";
const dashiSource: CatalogSource = { name: "Dashi", url: DASHI, key: line(dashiKey), builtIn: true };
const teamSource: CatalogSource = { name: "Team", url: TEAM, key: line(teamKey), builtIn: false };

const manifest = (id: string, version = "0.1.0") => ({
  id,
  name: id.split(".").at(-1) ?? id,
  version,
  dashi: ">=0.4",
  entry: "src/main.tsx",
  summary: "A test applet.",
  author: { name: "Alex Kim" },
  categories: [],
  permissions: [],
  commands: [],
  screenshots: [],
});

const packageOf = (id: string, version: string): Uint8Array =>
  writeTar(
    new Map([
      ["applet.json", new TextEncoder().encode(JSON.stringify(manifest(id, version)))],
      ["main.js", new TextEncoder().encode(`console.log(${JSON.stringify(version)})`)],
    ]),
  );

/** An index entry (parsed shape) with packages on `host`, or on disk under `dir`. */
function entry(
  id: string,
  options: { host?: string; dir?: string; versions?: string[]; pulled?: string[]; icon?: string; reviewed?: boolean } = {},
): IndexApplet {
  const versions = (options.versions ?? ["0.1.0"]).map((version) => {
    const bytes = packageOf(id, version);
    let url = `https://${options.host ?? "github.com"}/releases/${id}-${version}.dashi-applet`;
    if (options.dir) {
      url = `file://${join(options.dir, `${id}-${version}.dashi-applet`)}`;
      writeFileSync(new URL(url), bytes);
    }
    return {
      version,
      dashi: ">=0.4",
      url,
      sha256: sha256(bytes),
      size: bytes.byteLength,
      signature: sign(bytes, author.secretKey, trustedComment({ id, version }, sha256(bytes))),
      released: "2026-11-04",
    };
  });
  return {
    manifest: { ...manifest(id, versions[0]?.version), when: undefined } as unknown as IndexApplet["manifest"],
    authorKey: line(author),
    reviewed: options.reviewed ?? true,
    source: { url: "https://github.com/alexk/applet", commit: "0123456" },
    ...(options.icon ? { icon: options.icon } : {}),
    screenshots: [],
    versions: [...versions].reverse(),
    pulled: (options.pulled ?? []).map((version) => ({ version, reason: "breaks things" })),
  };
}

const indexOf = (applets: IndexApplet[]): CatalogIndex => ({ format: 1, generated: "2026-11-05T00:00:00Z", applets, skipped: [] });
const loaded = (source: CatalogSource, applets: IndexApplet[]): CatalogLoad => ({ source, index: indexOf(applets), stale: false, problem: null });

/** An index on disk, signed with `signer`, its packages beside it: a file:// catalog. */
function onDisk(signer: KeyPair, applets: (dir: string) => IndexApplet[]): { url: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "dashi-catalog-"));
  const bytes = new TextEncoder().encode(JSON.stringify({ format: 1, generated: "2026-11-05T00:00:00Z", applets: applets(dir) }));
  writeFileSync(join(dir, "index.json"), bytes);
  writeFileSync(join(dir, "index.json.minisig"), sign(bytes, signer.secretKey, "timestamp:1 file:index.json"));
  return { url: `file://${join(dir, "index.json")}`, dir };
}

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
