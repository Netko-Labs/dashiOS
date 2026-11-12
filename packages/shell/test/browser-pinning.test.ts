import { describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { HOST } from "../browser-extension/src/host-name.ts";
import { crc32, crx3, extensionId, idFromManifestKey, isExtensionId, publicDer, updateManifest, zip } from "../src/browser/crx.ts";
import { callerExtension, EXTENSION_ID, encodeFrame, FrameReader, HOST_NAME, MAX_TO_EXTENSION } from "../src/browser/native.ts";

const repo = join(import.meta.dir, "../../..");
const readJson = (path: string) => JSON.parse(readFileSync(join(repo, path), "utf8")) as Record<string, unknown>;

describe("the extension's id is pinned", () => {
  const manifest = readJson("packages/shell/browser-extension/manifest.json") as { key: string; version: string; permissions: string[] };

  test("the manifest's key gives the id the host and the policy name", () => {
    expect(isExtensionId(EXTENSION_ID)).toBe(true);
    expect(idFromManifestKey(manifest.key)).toBe(EXTENSION_ID);
  });

  test("the native host's manifest allows only that extension, and runs Dashi's host", () => {
    const host = readJson("spin/dashi-helium/etc/chromium/native-messaging-hosts/dev.dashi.browser.json");
    expect(host.name).toBe(HOST_NAME);
    expect(host.type).toBe("stdio");
    expect(host.path).toBe("/usr/libexec/dashi/dashi-browser-host");
    expect(host.allowed_origins).toEqual([`chrome-extension://${EXTENSION_ID}/`]);
    expect(HOST).toBe(HOST_NAME);
  });

  test("the policy force-installs that extension from Dashi's update manifest", () => {
    const policy = readJson("spin/dashi-helium/etc/chromium/policies/managed/dashi.json") as {
      ExtensionSettings: Record<string, Record<string, string>>;
    };
    expect(Object.keys(policy.ExtensionSettings)).toEqual([EXTENSION_ID]);
    expect(policy.ExtensionSettings[EXTENSION_ID]).toMatchObject({
      installation_mode: "force_installed",
      update_url: "file:///usr/share/dashi/browser/updates.xml",
    });
  });

  test("the host serves only the pinned extension", () => {
    expect(callerExtension([`chrome-extension://${EXTENSION_ID}/`])).toBe(EXTENSION_ID);
    expect(callerExtension([`chrome-extension://${EXTENSION_ID}/`, "--parent-window=0"])).toBe(EXTENSION_ID);
    expect(callerExtension(["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"])).toBeNull();
    expect(callerExtension([`chrome-extension://${EXTENSION_ID}/../x`])).toBeNull();
    expect(callerExtension([])).toBeNull();
  });

  test("no private key is in the extension's folder", () => {
    const folder = join(repo, "packages/shell/browser-extension");
    const files = readdirSync(folder, { recursive: true, encoding: "utf8" }).filter((file) => !file.split("/").includes("node_modules"));
    expect(files).toContain("manifest.json");
    for (const file of files) {
      const path = join(folder, file);
      if (!statSync(path).isFile()) continue;
      expect(file).not.toMatch(/\.(pem|key)$/);
      expect(readFileSync(path, "utf8"), file).not.toContain("PRIVATE KEY");
    }
  });
});

/** A protobuf message's length-delimited fields, by number (the last of each). */
function fields(bytes: Uint8Array): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  let at = 0;
  const varint = () => {
    let value = 0;
    let shift = 1;
    for (;;) {
      const byte = bytes[at++] as number;
      value += (byte & 0x7f) * shift;
      shift *= 128;
      if (byte < 0x80) return value;
    }
  };
  while (at < bytes.byteLength) {
    const tag = varint();
    expect(tag % 8).toBe(2);
    const length = varint();
    out.set(Math.floor(tag / 8), bytes.subarray(at, at + length));
    at += length;
  }
  return out;
}

describe("the CRX", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  test("an id is the key's hash in letters a to p", () => {
    const der = publicDer(pem);
    const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
    expect(extensionId(der)).toBe([...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join(""));
  });

  test("is Cr24, version 3, a header with the key and a signature over the signed data and the ZIP", () => {
    const archive = zip([{ path: "manifest.json", data: new TextEncoder().encode("{}") }]);
    const crx = crx3(archive, pem);
    const view = new DataView(crx.buffer);
    expect(new TextDecoder().decode(crx.subarray(0, 4))).toBe("Cr24");
    expect(view.getUint32(4, true)).toBe(3);
    const headerLength = view.getUint32(8, true);
    expect(crx.subarray(12 + headerLength)).toEqual(archive);
    const header = fields(crx.subarray(12, 12 + headerLength));
    const proof = fields(header.get(2) as Uint8Array);
    const key = proof.get(1) as Uint8Array;
    expect(key).toEqual(publicDer(pem));
    const signedHeader = header.get(10000) as Uint8Array;
    const crxId = createHash("sha256").update(key).digest().subarray(0, 16);
    expect(fields(signedHeader).get(1)).toEqual(new Uint8Array(crxId));
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, signedHeader.byteLength, true);
    const signed = Buffer.concat([Buffer.from("CRX3 SignedData\x00"), length, signedHeader, archive]);
    expect(verify("sha256", signed, publicKey, proof.get(2) as Uint8Array)).toBe(true);
  });

  test("the ZIP's checksums are CRC-32's", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  test("the update manifest names the id, the version and the CRX", () => {
    const xml = updateManifest(EXTENSION_ID, "0.5.0", "file:///usr/share/dashi/browser/dashi-browser.crx");
    expect(xml).toContain(`<app appid='${EXTENSION_ID}'>`);
    expect(xml).toContain("codebase='file:///usr/share/dashi/browser/dashi-browser.crx' version='0.5.0'");
  });
});

describe("native messaging frames", () => {
  test("a length in little-endian, then the JSON", () => {
    const frame = encodeFrame({ id: 1, method: "tabs" });
    expect(frame).not.toBeNull();
    const reader = new FrameReader();
    // In pieces, as a pipe delivers them.
    expect(reader.push((frame as Uint8Array).subarray(0, 3))).toEqual([]);
    expect(reader.push((frame as Uint8Array).subarray(3))).toEqual([{ id: 1, method: "tabs" }]);
  });

  test("nothing over Chromium's limit goes to the extension; a huge frame from it ends the host", () => {
    expect(encodeFrame({ text: "x".repeat(MAX_TO_EXTENSION) })).toBeNull();
    const reader = new FrameReader();
    expect(() => reader.push(new Uint8Array([0xff, 0xff, 0xff, 0x7f]))).toThrow();
  });
});
