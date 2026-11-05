/**
 * Ed25519 signatures in minisign's format (https://jedisct1.github.io/minisign/),
 * so authors and CI can use the `minisign` tool and Dashi checks with this.
 *
 *   public key   untrusted comment: minisign public key <ID>
 *                base64("Ed" ‖ key id (8) ‖ public key (32))
 *   signature    untrusted comment: …
 *                base64("ED" ‖ key id (8) ‖ Ed25519(BLAKE2b-512(file)))     ("Ed": over the file itself, legacy)
 *                trusted comment: …
 *                base64(Ed25519(signature ‖ trusted comment))
 *   secret key   base64("Ed" ‖ kdf ‖ "B2" ‖ salt (32) ‖ ops (8) ‖ mem (8) ‖ key id (8) ‖ secret key (64) ‖ checksum (32))
 *
 * Verifying needs only the public key. Signing here takes unencrypted secret
 * keys (`minisign -G -W`, or `generateKeys`): for tests and throwaway dev
 * keys. Real keys stay encrypted and sign with the minisign tool (docs/applets.md, "Keys").
 */

import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify, generateKeyPairSync, type KeyObject, randomBytes } from "node:crypto";

const PUBLIC_LENGTH = 42;
const SIGNATURE_LENGTH = 74;
const SECRET_LENGTH = 158;
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

export interface PublicKey {
  /** 8 bytes, as the signature names it. */
  keyId: Uint8Array;
  key: Uint8Array;
}

/** How minisign prints a key id: hex of the little-endian number, uppercase. */
export const keyIdText = (keyId: Uint8Array): string => Buffer.from(keyId).reverse().toString("hex").toUpperCase();

const equal = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((byte, at) => byte === b[at]);

function decode(line: string): Uint8Array | null {
  const trimmed = line.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  return new Uint8Array(Buffer.from(trimmed, "base64"));
}

/** The key's base64 line, or a whole .pub file. */
export function parsePublicKey(text: string): PublicKey | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("untrusted comment:"));
  if (lines.length !== 1) return null;
  const bytes = decode(lines[0] ?? "");
  if (!bytes || bytes.byteLength !== PUBLIC_LENGTH || bytes[0] !== 0x45 || bytes[1] !== 0x64) return null;
  return { keyId: bytes.slice(2, 10), key: bytes.slice(10) };
}

/** The public key's base64 line (what the index lists for an author). */
export function publicKeyLine(key: PublicKey): string {
  return Buffer.concat([Buffer.from("Ed"), key.keyId, key.key]).toString("base64");
}

const blake2b512 = (data: Uint8Array): Uint8Array => new Uint8Array(new Bun.CryptoHasher("blake2b512").update(data).digest());

function publicKeyObject(key: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.concat([SPKI, key]), format: "der", type: "spki" });
}

export type Verified = { ok: true; trustedComment: string; keyId: string } | { ok: false; reason: string };

/** Checks `signature` (a .minisig file's text) over `message` with `publicKey`. */
export function verify(message: Uint8Array, signature: string, publicKey: PublicKey | string): Verified {
  const key = typeof publicKey === "string" ? parsePublicKey(publicKey) : publicKey;
  if (!key) return { ok: false, reason: "the public key is not a minisign key" };
  const lines = signature.split("\n").map((line) => line.replace(/\r$/, ""));
  if (!lines[0]?.startsWith("untrusted comment:")) return { ok: false, reason: "the signature has no untrusted comment line" };
  const sig = decode(lines[1] ?? "");
  if (!sig || sig.byteLength !== SIGNATURE_LENGTH) return { ok: false, reason: "the signature is malformed" };
  const algorithm = String.fromCharCode(sig[0] ?? 0, sig[1] ?? 0);
  if (algorithm !== "Ed" && algorithm !== "ED") return { ok: false, reason: "the signature's algorithm is unknown" };
  if (!equal(sig.slice(2, 10), key.keyId)) return { ok: false, reason: `signed by key ${keyIdText(sig.slice(2, 10))}, not ${keyIdText(key.keyId)}` };
  const signed = algorithm === "ED" ? blake2b512(message) : message;
  const object = publicKeyObject(key.key);
  if (!edVerify(null, signed, object, sig.slice(10))) return { ok: false, reason: "the signature does not match the file" };
  const trusted = lines[2];
  if (!trusted?.startsWith("trusted comment: ")) return { ok: false, reason: "the signature has no trusted comment" };
  const comment = trusted.slice("trusted comment: ".length);
  const global = decode(lines[3] ?? "");
  if (!global || global.byteLength !== 64) return { ok: false, reason: "the trusted comment's signature is malformed" };
  if (!edVerify(null, Buffer.concat([sig.slice(10), Buffer.from(comment)]), object, global)) return { ok: false, reason: "the trusted comment was changed" };
  return { ok: true, trustedComment: comment, keyId: keyIdText(key.keyId) };
}

/**
 * Only the trusted comment's signature, which needs no file: that `key`
 * made this .minisig, and what its comment says. The catalog checks this
 * before the package is rebuilt; `verify` checks the file itself.
 */
export function verifyTrustedComment(signature: string, publicKey: PublicKey | string): Verified {
  const key = typeof publicKey === "string" ? parsePublicKey(publicKey) : publicKey;
  if (!key) return { ok: false, reason: "the public key is not a minisign key" };
  const lines = signature.split("\n").map((line) => line.replace(/\r$/, ""));
  const sig = decode(lines[1] ?? "");
  if (!sig || sig.byteLength !== SIGNATURE_LENGTH) return { ok: false, reason: "the signature is malformed" };
  if (!equal(sig.slice(2, 10), key.keyId)) return { ok: false, reason: `signed by key ${keyIdText(sig.slice(2, 10))}, not ${keyIdText(key.keyId)}` };
  const trusted = lines[2];
  const global = decode(lines[3] ?? "");
  if (!trusted?.startsWith("trusted comment: ") || !global || global.byteLength !== 64) return { ok: false, reason: "the signature has no trusted comment" };
  const comment = trusted.slice("trusted comment: ".length);
  if (!edVerify(null, Buffer.concat([sig.slice(10), Buffer.from(comment)]), publicKeyObject(key.key), global))
    return { ok: false, reason: "the trusted comment was changed, or another key signed it" };
  return { ok: true, trustedComment: comment, keyId: keyIdText(key.keyId) };
}

export interface KeyPair {
  /** The .pub file. */
  publicKey: string;
  /** The unencrypted .key file (`minisign -W`): never commit one, keep real keys encrypted. */
  secretKey: string;
  keyId: string;
}

const checksum = (keyId: Uint8Array, secret: Uint8Array): Uint8Array =>
  new Uint8Array(new Bun.CryptoHasher("blake2b256").update(Buffer.concat([Buffer.from("Ed"), keyId, secret])).digest());

/** A new key pair; the secret key is unencrypted. For tests and dev keys only. */
export function generateKeys(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = new Uint8Array(Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url"));
  const seed = new Uint8Array(Buffer.from(privateKey.export({ format: "jwk" }).d ?? "", "base64url"));
  const keyId = new Uint8Array(randomBytes(8));
  const secret = Buffer.concat([seed, pub]);
  const file = Buffer.concat([
    Buffer.from("Ed"),
    Buffer.from([0, 0]),
    Buffer.from("B2"),
    Buffer.alloc(32),
    Buffer.alloc(8),
    Buffer.alloc(8),
    keyId,
    secret,
    checksum(keyId, secret),
  ]);
  const id = keyIdText(keyId);
  return {
    publicKey: `untrusted comment: minisign public key ${id}\n${publicKeyLine({ keyId, key: pub })}\n`,
    secretKey: `untrusted comment: minisign secret key (unencrypted)\n${file.toString("base64")}\n`,
    keyId: id,
  };
}

interface SecretKey {
  keyId: Uint8Array;
  seed: Uint8Array;
}

function parseSecretKey(text: string): SecretKey | { error: string } {
  const line = text.split("\n").find((each) => each.trim() !== "" && !each.startsWith("untrusted comment:"));
  const bytes = decode(line ?? "");
  if (!bytes || bytes.byteLength !== SECRET_LENGTH) return { error: "not a minisign secret key" };
  if (bytes[2] !== 0 || bytes[3] !== 0) return { error: "the secret key is encrypted: sign with the minisign tool" };
  const keyId = bytes.slice(54, 62);
  const secret = bytes.slice(62, 126);
  if (!equal(bytes.slice(126), checksum(keyId, secret))) return { error: "the secret key's checksum is wrong" };
  return { keyId, seed: secret.slice(0, 32) };
}

/** A .minisig for `message`, prehashed ("ED") as minisign signs by default. */
export function sign(message: Uint8Array, secretKey: string, trustedComment: string, untrustedComment = "signature from minisign secret key"): string {
  const key = parseSecretKey(secretKey);
  if ("error" in key) throw new Error(key.error);
  if (trustedComment.includes("\n")) throw new Error("a trusted comment is one line");
  const object = createPrivateKey({ key: Buffer.concat([PKCS8, key.seed]), format: "der", type: "pkcs8" });
  const signature = edSign(null, blake2b512(message), object);
  const global = edSign(null, Buffer.concat([signature, Buffer.from(trustedComment)]), object);
  const sig = Buffer.concat([Buffer.from("ED"), key.keyId, signature]);
  return `untrusted comment: ${untrustedComment}\n${sig.toString("base64")}\ntrusted comment: ${trustedComment}\n${global.toString("base64")}\n`;
}
