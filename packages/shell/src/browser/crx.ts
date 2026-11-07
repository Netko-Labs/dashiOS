/**
 * Dashi's browser extension as Chromium installs it (docs/actions.md,
 * "Websites"): its id from its public key, a ZIP of its files, and the CRX3
 * that wraps the ZIP with a signature by that key. Chromium checks the
 * signature and takes the id from the key, so the id the native host and the
 * policy name is the one the package's key gives, whoever packs it.
 *
 * Pure but for signing (node:crypto), so the format is tested.
 */

import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";

/** An extension id: the first 16 bytes of SHA-256 of its public key (DER), each hex digit as a letter from a to p. */
export function extensionId(publicKeyDer: Uint8Array): string {
  const digest = createHash("sha256").update(publicKeyDer).digest();
  return [...digest.subarray(0, 16)].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("");
}

/** The id from a manifest's `key` (base64 DER), as Chromium reads it. */
export function idFromManifestKey(key: string): string {
  return extensionId(Buffer.from(key, "base64"));
}

/** A PEM private key's public half, as DER (what the manifest's `key` holds, base64). */
export function publicDer(privatePem: string): Uint8Array {
  return new Uint8Array(createPublicKey(createPrivateKey(privatePem)).export({ type: "spki", format: "der" }));
}

/** Whether `id` looks like an extension id (32 letters a to p). */
export const isExtensionId = (id: string): boolean => /^[a-p]{32}$/.test(id);

// --- ZIP (stored, no compression: Chromium's unzipper takes it) ---

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1 January 2026, 00:00, in DOS time: every entry gets it, so a ZIP of the same files is the same bytes. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** A ZIP of `files` (path → bytes), stored, in the order given. */
export function zip(files: ReadonlyArray<{ path: string; data: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const { path, data } of files) {
    const name = new TextEncoder().encode(path);
    const crc = crc32(data);
    const common = [u16(0), u16(0), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(data.byteLength), u32(data.byteLength), u16(name.byteLength), u16(0)];
    const local = concat([u32(0x04034b50), u16(20), ...common, name, data]);
    central.push(concat([u32(0x02014b50), u16(20), u16(20), ...common, u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    locals.push(local);
    offset += local.byteLength;
  }
  const directory = concat(central);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(directory.byteLength), u32(offset), u16(0)]);
  return concat([...locals, directory, end]);
}

// --- CRX3 ---

/** A protobuf varint. */
function varint(value: number): Uint8Array {
  const out: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return new Uint8Array(out);
}

/** A length-delimited protobuf field. */
const field = (number: number, bytes: Uint8Array): Uint8Array => concat([varint((number << 3) | 2), varint(bytes.byteLength), bytes]);

const SIGNED_DATA_PREFIX = new TextEncoder().encode("CRX3 SignedData\x00");

/**
 * A CRX3: "Cr24", version 3, the header (CrxFileHeader: an RSA proof of the
 * key and the signed header data, SignedData{crx_id}), then the ZIP. The
 * signature covers the prefix, the signed header data's length and bytes, and
 * the ZIP.
 */
export function crx3(archive: Uint8Array, privatePem: string): Uint8Array {
  const key = publicDer(privatePem);
  const crxId = createHash("sha256").update(key).digest().subarray(0, 16);
  const signedHeaderData = field(1, new Uint8Array(crxId));
  const signature = sign("sha256", concat([SIGNED_DATA_PREFIX, u32(signedHeaderData.byteLength), signedHeaderData, archive]), createPrivateKey(privatePem));
  const proof = concat([field(1, key), field(2, new Uint8Array(signature))]);
  const header = concat([field(2, proof), field(10000, signedHeaderData)]);
  return concat([new TextEncoder().encode("Cr24"), u32(3), u32(header.byteLength), header, archive]);
}

/** The update manifest a policy points Chromium at: this id, this version, the CRX at `crxUrl`. */
export function updateManifest(id: string, version: string, crxUrl: string): string {
  const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/'/g, "&apos;").replace(/</g, "&lt;");
  return [
    "<?xml version='1.0' encoding='UTF-8'?>",
    "<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>",
    `  <app appid='${attr(id)}'>`,
    `    <updatecheck codebase='${attr(crxUrl)}' version='${attr(version)}' />`,
    "  </app>",
    "</gupdate>",
    "",
  ].join("\n");
}
