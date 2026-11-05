import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeys, type KeyPair, readInstalled, sha256, sign, trustedComment, writeTar } from "@dashi/applet";
import { Catalog, CatalogError } from "../src/applet-store/catalog.ts";
import { AppletInstaller, statusOf } from "../src/applet-store/installer.ts";
import { hardwareNames, parseBusctlString, readMachine } from "../src/applet-store/machine.ts";

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
function catalogTree(options: { versions: string[]; signer?: KeyPair; listedKey?: KeyPair; pulled?: string[]; indexSigner?: KeyPair }) {
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
        manifest: { ...MANIFEST, version: options.versions.at(-1) },
        authorKey: keyLine(options.listedKey ?? author),
        reviewed: true,
        source: { url: "https://github.com/Netko-Labs/asus-control", commit: "0123456" },
        versions,
        pulled: (options.pulled ?? []).map((version) => ({ version, reason: "drains the battery" })),
      },
    ],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(index));
  writeFileSync(join(dir, "index.json"), bytes);
  writeFileSync(join(dir, "index.json.minisig"), sign(bytes, (options.indexSigner ?? dashi).secretKey, "timestamp:1 file:index.json"));
  return { dir, url: `file://${join(dir, "index.json")}` };
}

function setup(tree: { url: string }, root = mkdtempSync(join(tmpdir(), "dashi-applets-"))) {
  const cacheDir = mkdtempSync(join(tmpdir(), "dashi-store-cache-"));
  const catalog = new Catalog({ url: tree.url, key: dashi.publicKey, cacheDir });
  const installer = new AppletInstaller({
    root,
    dataRoot: join(root, "..", "data"),
    dashiVersion: "0.4.0",
    download: (url, size) => catalog.download(url, size),
  });
  return { catalog, installer, root, cacheDir };
}

test("the store installs only what checks: Dashi's index, the size and hash, the author's signature", async () => {
  const tree = catalogTree({ versions: ["0.1.0"] });
  const { catalog, installer, root } = setup(tree);
  const { index, stale } = await catalog.load();
  expect(stale).toBe(false);
  const entry = index.applets[0];
  if (!entry) throw new Error("an entry");
  expect(statusOf(entry, [], "0.4.0").kind).toBe("get");
  await installer.install(entry, ["hardware.power", "notifications", "network"]);
  const [installed] = readInstalled(root);
  expect(installed?.record).toMatchObject({ version: "0.1.0", source: "catalog", authorKey: keyLine(author), consent: ["hardware.power", "notifications"] });
  expect(statusOf(entry, readInstalled(root), "0.4.0").kind).toBe("installed");

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
  const entry = (await one.catalog.load()).index.applets[0];
  if (!entry) throw new Error("an entry");
  await expect(one.installer.install(entry, [])).rejects.toThrow(/signed by key/);

  const first = catalogTree({ versions: ["0.1.0"] });
  const two = setup(first);
  const v1 = (await two.catalog.load()).index.applets[0];
  if (!v1) throw new Error("an entry");
  await two.installer.install(v1, []);
  // The next index lists 0.2.0 under another author key (signed by it): the installed one's key doesn't match.
  const rekeyed = catalogTree({ versions: ["0.1.0", "0.2.0"], signer: stranger, listedKey: stranger });
  const three = setup(rekeyed, two.root);
  const v2 = (await three.catalog.load()).index.applets[0];
  if (!v2) throw new Error("an entry");
  expect(statusOf(v2, readInstalled(two.root), "0.4.0").kind).toBe("update");
  await expect(three.installer.install(v2, [])).rejects.toThrow(/different key/);
  expect(readInstalled(two.root)[0]?.record.version).toBe("0.1.0");
});

test("the kill switch: a pulled version is disabled where it is installed, and the good one offered", async () => {
  const before = catalogTree({ versions: ["0.1.0", "0.2.0"] });
  const one = setup(before);
  const entry = (await one.catalog.load()).index.applets[0];
  if (!entry) throw new Error("an entry");
  await one.installer.install(entry, []);
  expect(readInstalled(one.root)[0]?.record.version).toBe("0.2.0");
  const after = catalogTree({ versions: ["0.1.0", "0.2.0"], pulled: ["0.2.0"] });
  const two = setup(after, one.root);
  const { index } = await two.catalog.load();
  expect(two.installer.disablePulled(index)).toEqual([MANIFEST.id]);
  const [installed] = readInstalled(one.root);
  expect(installed?.record.disabled).toEqual({ reason: "pulled", detail: "drains the battery" });
  const pulled = index.applets[0];
  if (!pulled) throw new Error("an entry");
  expect(statusOf(pulled, readInstalled(one.root), "0.4.0")).toMatchObject({ kind: "pulled", good: { version: "0.1.0" } });
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
