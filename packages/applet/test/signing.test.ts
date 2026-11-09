import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CatalogIndex,
  generateKeys,
  type IndexApplet,
  installable,
  pack,
  parseIndex,
  parsePublicKey,
  readTar,
  sha256,
  sign,
  trustedComment,
  unpack,
  verify,
  verifyIndex,
  verifyPackage,
  writeTar,
} from "../src/index.ts";
import { ASUS } from "./fixtures.ts";

// Throwaway keys, made for this run only: no key is ever committed.
const dashi = generateKeys();
const author = generateKeys();
const stranger = generateKeys();

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

test("minisign: a signature verifies with its key only, and any change to the file or the trusted comment is caught", () => {
  const file = bytes("index contents");
  const signature = sign(file, dashi.secretKey, "timestamp:1 file:index.json");
  expect(verify(file, signature, dashi.publicKey)).toMatchObject({ ok: true, trustedComment: "timestamp:1 file:index.json", keyId: dashi.keyId });
  expect(verify(bytes("index contents!"), signature, dashi.publicKey)).toMatchObject({ ok: false, reason: expect.stringContaining("does not match") });
  expect(verify(file, signature, stranger.publicKey)).toMatchObject({ ok: false, reason: expect.stringContaining("signed by key") });
  const lines = signature.split("\n");
  const forged = [lines[0], lines[1], "trusted comment: timestamp:2 file:other.json", lines[3]].join("\n");
  expect(verify(file, forged, dashi.publicKey)).toMatchObject({ ok: false, reason: expect.stringContaining("trusted comment") });
  expect(parsePublicKey(dashi.publicKey)?.key.byteLength).toBe(32);
  expect(parsePublicKey("not a key")).toBeNull();
  expect(() => sign(file, "untrusted comment: x\nAAAA\n", "t")).toThrow();
});

test("packages are the same bytes for the same files, and paths outside are refused", () => {
  const files = new Map([
    ["applet.json", bytes("{}")],
    ["main.js", bytes("console.log(1)")],
    ["assets/glyph.svg", bytes("<svg/>")],
  ]);
  const one = writeTar(files);
  const two = writeTar(new Map([...files].reverse()));
  expect(sha256(one)).toBe(sha256(two));
  const read = readTar(one);
  if ("error" in read) throw new Error(read.error);
  expect([...read.keys()]).toEqual(["applet.json", "assets/glyph.svg", "main.js"]);
  expect(() => writeTar(new Map([["../evil", bytes("x")]]))).toThrow();
  expect(readTar(bytes("not gzip"))).toHaveProperty("error");
});

function catalogEntry(packageBytes: Uint8Array, key = author, version = "0.1.0"): IndexApplet {
  const digest = sha256(packageBytes);
  return {
    manifest: { ...(parseIndexManifest() as IndexApplet["manifest"]), version },
    authorKey: key.publicKey.split("\n")[1] ?? "",
    reviewed: true,
    source: { url: "https://github.com/Netko-Labs/asus-control", commit: "0123456789abcdef0123456789abcdef01234567" },
    screenshots: [],
    versions: [
      {
        version,
        dashi: ">=0.4",
        url: `https://github.com/Netko-Labs/dashi-applets/releases/download/x/${ASUS.id}-${version}.dashi-applet`,
        sha256: digest,
        size: packageBytes.byteLength,
        signature: sign(packageBytes, key.secretKey, trustedComment({ id: ASUS.id, version }, digest)),
        released: "2026-11-04",
      },
    ],
    pulled: [],
  };
}

function parseIndexManifest(): unknown {
  const index = parseIndex({
    format: 1,
    generated: "x",
    applets: [
      {
        manifest: ASUS,
        authorKey: author.publicKey.split("\n")[1],
        source: { url: "https://github.com/x/y", commit: "abcdef0" },
        versions: [{ version: "0.1.0", dashi: ">=0.4", url: "https://x/y", sha256: "0".repeat(64), size: 1, signature: "x", released: "2026-11-04" }],
      },
    ],
  });
  if ("error" in index) throw new Error(index.error);
  return index.applets[0]?.manifest;
}

test("the store's checks: Dashi's signature on the index, then the package's size, hash, and author's signature", () => {
  const packageBytes = writeTar(
    new Map([
      ["applet.json", bytes(JSON.stringify(ASUS))],
      ["main.js", bytes("1")],
    ]),
  );
  const entry = catalogEntry(packageBytes);
  const index: CatalogIndex = { format: 1, generated: "2026-11-05T00:00:00Z", applets: [entry], skipped: [] };
  const { skipped: _none, ...wire } = index;
  const indexBytes = bytes(JSON.stringify({ ...wire, applets: index.applets.map((applet) => ({ ...applet, manifest: ASUS })) }));
  const indexSignature = sign(indexBytes, dashi.secretKey, "timestamp:1 file:index.json");
  const verified = verifyIndex(indexBytes, indexSignature, dashi.publicKey);
  if ("error" in verified) throw new Error(verified.error);
  expect(verified.applets[0]?.manifest.id).toBe(ASUS.id);
  // An index signed by anyone else, or changed after signing, is refused.
  expect(verifyIndex(indexBytes, sign(indexBytes, stranger.secretKey, "t"), dashi.publicKey)).toHaveProperty("error");
  expect(verifyIndex(bytes(`${new TextDecoder().decode(indexBytes)} `), indexSignature, dashi.publicKey)).toHaveProperty("error");

  const version = entry.versions[0];
  if (!version) throw new Error("a version");
  expect(verifyPackage(packageBytes, entry, version)).toBe(true);
  // A tampered package: one byte changed.
  const tampered = new Uint8Array(packageBytes);
  tampered[20] = (tampered[20] ?? 0) ^ 1;
  expect(verifyPackage(tampered, entry, version)).toMatchObject({ error: expect.stringContaining("sha256") });
  expect(verifyPackage(packageBytes.slice(1), entry, version)).toMatchObject({ error: expect.stringContaining("size") });
  // Signed by someone other than the key the index lists.
  const imposter = { ...entry, versions: [{ ...version, signature: sign(packageBytes, stranger.secretKey, "t") }] };
  expect(verifyPackage(packageBytes, imposter, imposter.versions[0] ?? version)).toMatchObject({ error: expect.stringContaining("signed by key") });
  // An update whose index entry now lists a different author key than the installed version's.
  const rekeyed = catalogEntry(packageBytes, stranger, "0.2.0");
  expect(verifyPackage(packageBytes, rekeyed, rekeyed.versions[0] ?? version, entry.authorKey)).toMatchObject({
    error: expect.stringContaining("different key"),
  });
  // Pulled: never installed, and not offered.
  const pulled = { ...entry, pulled: [{ version: "0.1.0", reason: "drains the battery" }] };
  expect(verifyPackage(packageBytes, pulled, version)).toMatchObject({ error: expect.stringContaining("pulled") });
  expect(installable(pulled, "0.4.0")).toBeNull();
  expect(installable(entry, "0.4.0")?.version).toBe("0.1.0");
  expect(installable(entry, "0.3.0")).toBeNull();
});

test("pack builds an applet into a package that unpacks to its manifest, the same bytes twice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-applet-pack-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "applet.json"), JSON.stringify({ ...ASUS, entry: "src/main.ts" }));
  writeFileSync(join(dir, "src/main.ts"), 'import { glyph } from "./glyph.ts";\nconsole.log(glyph);\n');
  writeFileSync(join(dir, "src/glyph.ts"), 'export const glyph = "<svg/>";\n');
  writeFileSync(join(dir, "assets/fan.svg"), "<svg/>");
  const first = await pack(dir);
  // Packed from another folder (CI's, not the author's): the bundle's module names don't change.
  const from = process.cwd();
  process.chdir(tmpdir());
  const second = await pack(dir).finally(() => process.chdir(from));
  expect(process.cwd()).toBe(from);
  expect(first.name).toBe("dev.netko.asus-control-0.1.0.dashi-applet");
  expect(first.sha256).toBe(second.sha256);
  const unpacked = unpack(first.bytes);
  if ("error" in unpacked) throw new Error(unpacked.error);
  expect(unpacked.manifest.id).toBe(ASUS.id);
  expect([...unpacked.files.keys()].sort()).toEqual(["applet.json", "assets/fan.svg", "build.json", "main.js"]);
  expect(new TextDecoder().decode(unpacked.files.get("main.js"))).toContain("<svg/>");
  expect(unpack(writeTar(new Map([["applet.json", bytes(JSON.stringify(ASUS))]])))).toMatchObject({ error: expect.stringContaining("main.js") });
  expect(
    unpack(
      writeTar(
        new Map([
          ["applet.json", bytes(JSON.stringify(ASUS))],
          ["main.js", bytes("1")],
          ["run.sh", bytes("x")],
        ]),
      ),
    ),
  ).toHaveProperty("error");
});
