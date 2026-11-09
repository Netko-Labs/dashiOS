import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeys, type IndexApplet, type KeyPair, readInstalled, scanInstalled, sha256, sign, trustedComment, writeTar } from "@dashi/applet";
import { Catalog, CatalogError } from "../src/applet-store/catalog.ts";
import { AppletInstaller, statusOf } from "../src/applet-store/installer.ts";
import { applyKillSwitch } from "../src/applet-store/kill-switch.ts";
import { hardwareNames, parseBusctlString, readMachine } from "../src/applet-store/machine.ts";
import { type CatalogLoad, mergeCatalogs, type StoreApplet, skippedCount } from "../src/applet-store/merge.ts";

// Throwaway keys for this run only.
const dashi = generateKeys();
const author = generateKeys();
const stranger = generateKeys();
const keyLine = (key: KeyPair): string => key.publicKey.split("\n")[1] ?? "";

const MANIFEST = {
  id: "dev.netko.asus-control",
  name: "ASUS Control",
  version: "0.1.0",
  dashi: ">=0.4",
  entry: "src/main.tsx",
  summary: "Fans, power and lights for ROG and TUF laptops.",
  author: { name: "Netko Labs" },
  categories: ["hardware"],
  when: { vendor: "ASUSTeK COMPUTER INC.", laptop: true },
  permissions: ["hardware.power", "notifications"],
};

function packageOf(version: string): Uint8Array {
  return writeTar(
    new Map([
      ["applet.json", new TextEncoder().encode(JSON.stringify({ ...MANIFEST, version }))],
      ["main.js", new TextEncoder().encode(`console.log(${JSON.stringify(version)})`)],
    ]),
  );
}

/** A catalog on disk (file:// URLs), signed with throwaway keys; `tamper` changes a package after it was listed. */
function catalogTree(options: {
  versions: string[];
  signer?: KeyPair;
  listedKey?: KeyPair;
  pulled?: string[];
  indexSigner?: KeyPair;
  /** What the listed manifest says besides (a permission from a newer Dashi, say). */
  manifest?: Record<string, unknown>;
  /** More entries, as they are. */
  extra?: unknown[];
}) {
  const dir = mkdtempSync(join(tmpdir(), "dashi-catalog-"));
  const signer = options.signer ?? author;
  const versions = options.versions.map((version) => {
    const bytes = packageOf(version);
    const file = join(dir, `${MANIFEST.id}-${version}.dashi-applet`);
    writeFileSync(file, bytes);
    return {
      version,
      dashi: ">=0.4",
      url: `file://${file}`,
      sha256: sha256(bytes),
      size: bytes.byteLength,
      signature: sign(bytes, signer.secretKey, trustedComment({ id: MANIFEST.id, version }, sha256(bytes))),
      released: "2026-11-04",
    };
  });
  const index = {
    format: 1,
    generated: "2026-11-05T00:00:00Z",
    applets: [
      {
        manifest: { ...MANIFEST, version: options.versions.at(-1), ...options.manifest },
        authorKey: keyLine(options.listedKey ?? author),
        reviewed: true,
        source: { url: "https://github.com/Netko-Labs/asus-control", commit: "0123456" },
        versions,
        pulled: (options.pulled ?? []).map((version) => ({ version, reason: "drains the battery" })),
      },
      ...(options.extra ?? []),
    ],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(index));
  writeFileSync(join(dir, "index.json"), bytes);
  writeFileSync(join(dir, "index.json.minisig"), sign(bytes, (options.indexSigner ?? dashi).secretKey, "timestamp:1 file:index.json"));
  return { dir, url: `file://${join(dir, "index.json")}` };
}

/** Dashi's catalog as installs record it: each tree below is the same catalog's index at another time. */
const DASHI_URL = "https://raw.githubusercontent.com/Netko-Labs/dashi-applets/index/index.json";
const fromDashi = (entry: IndexApplet | undefined): StoreApplet => {
  if (!entry) throw new Error("an entry");
  return { ...entry, from: { name: "Dashi", url: DASHI_URL, builtIn: true } };
};

function setup(tree: { url: string }, root = mkdtempSync(join(tmpdir(), "dashi-applets-"))) {
  const cacheDir = mkdtempSync(join(tmpdir(), "dashi-store-cache-"));
  const catalog = new Catalog({ url: tree.url, key: dashi.publicKey, cacheDir });
  const installer = new AppletInstaller({
    root,
    dataRoot: join(root, "..", "data"),
    dashiVersion: "0.4.0",
    dashiCatalog: DASHI_URL,
    download: (url, size) => catalog.download(url, size),
  });
  return { catalog, installer, root, cacheDir };
}

test("the store installs only what checks: Dashi's index, the size and hash, the author's signature", async () => {
  const tree = catalogTree({ versions: ["0.1.0"] });
  const { catalog, installer, root } = setup(tree);
  const { index, stale } = await catalog.load();
  expect(stale).toBe(false);
  const entry = fromDashi(index.applets[0]);
  expect(statusOf(entry, [], "0.4.0", DASHI_URL).kind).toBe("get");
  await installer.install(entry, ["hardware.power", "notifications", "network"]);
  const [installed] = readInstalled(root);
  expect(installed?.record).toMatchObject({
    version: "0.1.0",
    source: "catalog",
    catalog: DASHI_URL,
    authorKey: keyLine(author),
    consent: ["hardware.power", "notifications"],
  });
  expect(statusOf(entry, readInstalled(root), "0.4.0", DASHI_URL).kind).toBe("installed");

  // A tampered package: its bytes changed after the index listed them.
  writeFileSync(new URL(entry.versions[0]?.url ?? "").pathname, packageOf("0.1.0-tampered"));
  const fresh = setup(tree);
  await expect(fresh.installer.install(entry, [])).rejects.toThrow(/size|sha256/);
  expect(readInstalled(fresh.root)).toEqual([]);
});

test("an index not signed by Dashi is refused, and the last good one stands in", async () => {
  const good = catalogTree({ versions: ["0.1.0"] });
  const { catalog, cacheDir } = setup(good);
  await catalog.load();
  const forged = catalogTree({ versions: ["0.1.0"], indexSigner: stranger });
  const again = new Catalog({ url: forged.url, key: dashi.publicKey, cacheDir });
  expect((await again.load()).stale).toBe(true);
  const fresh = new Catalog({ url: forged.url, key: dashi.publicKey, cacheDir: mkdtempSync(join(tmpdir(), "dashi-store-cache-")) });
  await expect(fresh.load()).rejects.toBeInstanceOf(CatalogError);
  const keyless = new Catalog({ url: good.url, key: null, cacheDir });
  await expect(keyless.load()).rejects.toMatchObject({ kind: "no-key" });
});

test("a package signed by someone else than the listed author, or an update under a new key, is refused", async () => {
  const imposter = catalogTree({ versions: ["0.1.0"], signer: stranger });
  const one = setup(imposter);
  const entry = fromDashi((await one.catalog.load()).index.applets[0]);
  await expect(one.installer.install(entry, [])).rejects.toThrow(/signed by key/);

  const first = catalogTree({ versions: ["0.1.0"] });
  const two = setup(first);
  const v1 = fromDashi((await two.catalog.load()).index.applets[0]);
  await two.installer.install(v1, []);
  // The next index lists 0.2.0 under another author key (signed by it): the installed one's key doesn't match.
  const rekeyed = catalogTree({ versions: ["0.1.0", "0.2.0"], signer: stranger, listedKey: stranger });
  const three = setup(rekeyed, two.root);
  const v2 = fromDashi((await three.catalog.load()).index.applets[0]);
  expect(statusOf(v2, readInstalled(two.root), "0.4.0", DASHI_URL).kind).toBe("update");
  await expect(three.installer.install(v2, [])).rejects.toThrow(/different key/);
  expect(readInstalled(two.root)[0]?.record.version).toBe("0.1.0");
});

test("the kill switch: a pulled version is disabled where it is installed, and the good one offered", async () => {
  const before = catalogTree({ versions: ["0.1.0", "0.2.0"] });
  const one = setup(before);
  const entry = fromDashi((await one.catalog.load()).index.applets[0]);
  await one.installer.install(entry, []);
  expect(readInstalled(one.root)[0]?.record.version).toBe("0.2.0");
  const after = catalogTree({ versions: ["0.1.0", "0.2.0"], pulled: ["0.2.0"] });
  const two = setup(after, one.root);
  const { index } = await two.catalog.load();
  // The shell's daily look does it without the store open.
  const asDashi = { url: DASHI_URL, load: () => two.catalog.load() };
  expect(await applyKillSwitch([asDashi], two.installer)).toEqual([MANIFEST.id]);
  expect(two.installer.disablePulled(index, DASHI_URL)).toEqual([]);
  const [installed] = readInstalled(one.root);
  expect(installed?.record.disabled).toEqual({ reason: "pulled", detail: "drains the battery" });
  const pulled = fromDashi(index.applets[0]);
  expect(statusOf(pulled, readInstalled(one.root), "0.4.0", DASHI_URL)).toMatchObject({ kind: "pulled", good: { version: "0.1.0" } });
  // Installing the good one turns it back on.
  await two.installer.install(pulled, []);
  expect(readInstalled(one.root)[0]?.record).toMatchObject({ version: "0.1.0" });
  expect(readInstalled(one.root)[0]?.record.disabled).toBeUndefined();
});

test("this machine, for “fits this machine”: DMI and what dashi-hardware reports", async () => {
  const dmi = mkdtempSync(join(tmpdir(), "dmi-"));
  writeFileSync(join(dmi, "sys_vendor"), "ASUSTeK COMPUTER INC.\n");
  writeFileSync(join(dmi, "product_name"), "ROG Zephyrus G14 GA403WR_GA403WR\n");
  writeFileSync(join(dmi, "board_name"), "GA403WR\n");
  writeFileSync(join(dmi, "chassis_type"), "10\n");
  const describe = {
    knobs: { "platform-profile": {}, "kbd-backlight": {} },
    fans: [{ id: "cpu", curve: true }],
    lighting: { keyboard: { levels: 3 }, slash: true, aura: false },
  };
  expect(hardwareNames(describe)).toEqual(["fan-curves", "kbd-backlight", "keyboard-light", "platform-profile", "slash"]);
  const machine = await readMachine(dmi, async () => describe);
  expect(machine).toMatchObject({ vendor: "ASUSTeK COMPUTER INC.", board: "GA403WR", laptop: true, hardware: expect.arrayContaining(["slash"]) });
  expect(await readMachine(dmi, async () => null)).not.toHaveProperty("hardware");
  expect(parseBusctlString(`s "{\\"model\\":\\"GA403WR\\"}"`)).toEqual({ model: "GA403WR" });
  expect(parseBusctlString("garbage")).toBeNull();
});

/** An entry from a newer Dashi: a permission this one doesn't know. */
const NEWER = {
  manifest: { ...MANIFEST, id: "dev.example.lights", name: "Lights", permissions: ["lights.everywhere"] },
  authorKey: keyLine(author),
  source: { url: "https://github.com/x/lights", commit: "abcdef0" },
  versions: [{ version: "0.1.0", dashi: ">=0.9", url: "https://github.com/x", sha256: "0".repeat(64), size: 1, signature: "x", released: "2026-11-04" }],
};

test("an index with one entry this Dashi can't read lists the rest, says how many it left out, and never installs that one", async () => {
  const tree = catalogTree({ versions: ["0.1.0"], extra: [NEWER] });
  const { catalog, installer, root } = setup(tree);
  const { index } = await catalog.load();
  expect(index.applets.map((each) => each.manifest.id)).toEqual([MANIFEST.id]);
  expect(index.skipped).toEqual([{ id: "dev.example.lights", reason: expect.stringContaining("lights.everywhere"), pulled: [] }]);
  // As the store lists it (a local catalog may serve local files).
  const source = { name: "Dashi", url: tree.url, key: dashi.publicKey, builtIn: true };
  const loads: CatalogLoad[] = [{ source, index, stale: false, problem: null }];
  const listed = mergeCatalogs(loads, [], tree.url);
  expect(listed.map((each) => each.manifest.id)).toEqual([MANIFEST.id]);
  expect(skippedCount(loads, listed)).toBe(1);
  // One that another catalog lists in a form that reads isn't counted.
  const first = listed[0];
  if (!first) throw new Error("an entry");
  expect(skippedCount(loads, [...listed, { ...first, manifest: { ...first.manifest, id: "dev.example.lights" } }])).toBe(0);
  // The rest installs as before.
  await installer.install(fromDashi(index.applets[0]), []);
  expect(readInstalled(root).map((each) => each.manifest.id)).toEqual([MANIFEST.id]);
});

test("a bad signature refuses the whole index, the entries that read included", async () => {
  const forged = catalogTree({ versions: ["0.1.0"], extra: [NEWER], indexSigner: stranger });
  const { catalog } = setup(forged);
  await expect(catalog.load()).rejects.toMatchObject({ kind: "unsigned" });
  // Changed after signing: the same.
  const good = catalogTree({ versions: ["0.1.0"], extra: [NEWER] });
  const path = join(good.dir, "index.json");
  writeFileSync(path, readFileSync(path, "utf8").replace("ASUS Control", "ASUS Contro1"));
  await expect(setup(good).catalog.load()).rejects.toMatchObject({ kind: "unsigned" });
});

test("an entry this Dashi can't read still pulls: the kill switch reads its pulled list alone", async () => {
  const before = catalogTree({ versions: ["0.1.0", "0.2.0"] });
  const one = setup(before);
  await one.installer.install(fromDashi((await one.catalog.load()).index.applets[0]), []);
  // The next index lists it with a permission from a newer Dashi, and pulls 0.2.0.
  const after = catalogTree({ versions: ["0.1.0", "0.2.0"], pulled: ["0.2.0"], manifest: { permissions: ["lights.everywhere"] } });
  const two = setup(after, one.root);
  const { index } = await two.catalog.load();
  expect(index.applets).toEqual([]);
  expect(index.skipped[0]?.pulled).toEqual([{ version: "0.2.0", reason: "drains the battery" }]);
  expect(await applyKillSwitch([{ url: DASHI_URL, load: () => two.catalog.load() }], two.installer)).toEqual([MANIFEST.id]);
  expect(readInstalled(one.root)[0]?.record.disabled).toEqual({ reason: "pulled", detail: "drains the battery" });
});

test("an installed applet whose manifest no longer reads is listed as needing an update, which only its catalog and key can give", async () => {
  const first = catalogTree({ versions: ["0.1.0"] });
  const one = setup(first);
  await one.installer.install(fromDashi((await one.catalog.load()).index.applets[0]), ["hardware.power"]);
  // Its applet.json names something this Dashi doesn't know (an older Dashi than installed it, say).
  const manifestPath = join(one.root, MANIFEST.id, "applet.json");
  writeFileSync(manifestPath, JSON.stringify({ ...MANIFEST, permissions: ["lights.everywhere"] }));
  const scan = one.installer.scan();
  expect(scan.applets).toEqual([]);
  expect(scan.unreadable).toMatchObject([
    { id: MANIFEST.id, name: "ASUS Control", record: { version: "0.1.0" }, reason: expect.stringContaining("lights.everywhere") },
  ]);
  const unreadable = scan.unreadable;

  // Signed by another key: refused, and it stays as it was.
  const rekeyed = setup(catalogTree({ versions: ["0.1.0", "0.2.0"], signer: stranger, listedKey: stranger }), one.root);
  const imposter = fromDashi((await rekeyed.catalog.load()).index.applets[0]);
  expect(statusOf(imposter, [], "0.4.0", DASHI_URL, unreadable)).toMatchObject({ kind: "unreadable", good: { version: "0.2.0" } });
  await expect(rekeyed.installer.install(imposter, [])).rejects.toThrow(/different key/);
  // Another catalog's entry for the same id can't mend it.
  const elsewhere = { ...imposter, from: { name: "Team", url: "https://applets.example.com/index.json", builtIn: false } };
  expect(statusOf(elsewhere, [], "0.4.0", DASHI_URL, unreadable)).toMatchObject({ kind: "unreadable", good: null });
  await expect(rekeyed.installer.install(elsewhere, [])).rejects.toThrow(/another catalog/);

  // Its own catalog's next version, signed with its key, mends it; what was allowed stays allowed.
  const second = setup(catalogTree({ versions: ["0.1.0", "0.2.0"] }), one.root);
  const update = fromDashi((await second.catalog.load()).index.applets[0]);
  expect(statusOf(update, [], "0.4.0", DASHI_URL, unreadable)).toMatchObject({ kind: "unreadable", good: { version: "0.2.0" } });
  await second.installer.install(update, unreadable[0]?.record?.consent ?? []);
  expect(scanInstalled(one.root).unreadable).toEqual([]);
  expect(readInstalled(one.root)[0]?.record).toMatchObject({ version: "0.2.0", consent: ["hardware.power"] });

  // With its record damaged too, nothing says which key may update it: only Remove… is left.
  writeFileSync(manifestPath, "{}");
  writeFileSync(join(one.root, MANIFEST.id, "install.json"), "{}");
  await expect(second.installer.install(update, [])).rejects.toThrow(/remove it, then get it again/);
  expect(statusOf(update, [], "0.4.0", DASHI_URL, second.installer.scan().unreadable)).toMatchObject({ kind: "unreadable", good: null });
});
