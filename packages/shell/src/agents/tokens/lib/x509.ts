/**
 * Certificates for the token proxy (docs/secrets.md, "Tokens that stay
 * home"): a CA made for one agent sandbox, and leaf certificates it signs for
 * the hosts a token is for. P-256 keys from WebCrypto, signed with ECDSA
 * SHA-256; the DER is written here because Bun has no certificate builder.
 * Only what a TLS client checks is written: the names, the validity, the
 * basic constraints, the key usages, the subject's alternative name and the
 * key identifiers.
 *
 * The CA's private key lives in the shell's memory only and dies with the
 * sandbox; the sandbox gets the CA's certificate and nothing else.
 */

// --- DER -------------------------------------------------------------------

function length(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let rest = n; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function tlv(tag: number, ...content: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = content.reduce((sum, part) => sum + part.length, 0);
  const head = [tag, ...length(size)];
  const out = new Uint8Array(head.length + size);
  out.set(head, 0);
  let at = head.length;
  for (const part of content) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const sequence = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => tlv(0x30, ...parts);
const set = (...parts: Uint8Array[]): Uint8Array => tlv(0x31, ...parts);
const octets = (bytes: Uint8Array): Uint8Array => tlv(0x04, bytes);
const bits = (bytes: Uint8Array, unused = 0): Uint8Array => tlv(0x03, Uint8Array.of(unused), bytes);
const utf8 = (text: string): Uint8Array => tlv(0x0c, new TextEncoder().encode(text));
const TRUE = Uint8Array.of(0x01, 0x01, 0xff);

/** A non-negative INTEGER from big-endian bytes (leading zeros dropped, a zero added for the sign). */
function integer(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const trimmed = bytes.subarray(start);
  return tlv(0x02, (trimmed[0] ?? 0) & 0x80 ? Uint8Array.of(0, ...trimmed) : trimmed);
}

function oid(dotted: string): Uint8Array {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number);
  const out = [first * 40 + second];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let value = arc >>> 7; value > 0; value >>>= 7) chunk.unshift(0x80 | (value & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Uint8Array.from(out));
}

/** UTCTime until 2049, GeneralizedTime after (RFC 5280, 4.1.2.5). */
function time(date: Date): Uint8Array {
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const year = date.getUTCFullYear();
  return year < 2050 ? tlv(0x17, new TextEncoder().encode(`${iso.slice(2)}Z`)) : tlv(0x18, new TextEncoder().encode(`${iso}Z`));
}

const ECDSA_SHA256 = sequence(oid("1.2.840.10045.4.3.2"));
const name = (common: string): Uint8Array => sequence(set(sequence(oid("2.5.4.3"), utf8(common))));
const extension = (id: string, critical: boolean, value: Uint8Array): Uint8Array => sequence(oid(id), ...(critical ? [TRUE] : []), octets(value));

/** WebCrypto's raw r‖s signature as DER's SEQUENCE { r, s }. */
function derSignature(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  return sequence(integer(raw.subarray(0, half)), integer(raw.subarray(half)));
}

/** The subject public key's bits from an SPKI, for its key identifier (RFC 5280, 4.2.1.2, method 1). */
async function keyId(spki: Uint8Array): Promise<Uint8Array> {
  // A P-256 SPKI ends with the 65-byte uncompressed point.
  return new Uint8Array(await crypto.subtle.digest("SHA-1", spki.slice(spki.length - 65))).subarray(0, 20);
}

// --- PEM -------------------------------------------------------------------

export function pem(label: string, der: Uint8Array): string {
  const base64 = Buffer.from(der).toString("base64");
  return `-----BEGIN ${label}-----\n${base64.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END ${label}-----\n`;
}

// --- Certificates ----------------------------------------------------------

export interface KeyPair {
  privateKey: CryptoKey;
  /** The public key as an SPKI (DER). */
  spki: Uint8Array;
}

export interface Issued {
  /** The certificate, PEM. */
  cert: string;
  /** Its private key, PKCS #8 PEM, for the TLS server only. */
  key: string;
  notAfter: Date;
}

export interface Authority extends Issued {
  name: string;
  pair: KeyPair;
  id: Uint8Array;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A sandbox's CA outlives any agent's run; a leaf is made again before it gets old. */
export const CA_LIFETIME_MS = 90 * DAY;
export const LEAF_LIFETIME_MS = 7 * DAY;

async function keyPair(): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { privateKey: pair.privateKey, spki: new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)) };
}

async function privatePem(key: CryptoKey): Promise<string> {
  return pem("PRIVATE KEY", new Uint8Array(await crypto.subtle.exportKey("pkcs8", key)));
}

function serial(): Uint8Array {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = (bytes[0] ?? 0) & 0x7f;
  return integer(bytes);
}

async function sign(tbs: Uint8Array<ArrayBuffer>, signer: CryptoKey): Promise<Uint8Array> {
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer, tbs));
  return sequence(tbs, ECDSA_SHA256, bits(derSignature(raw)));
}

/** A CA for one sandbox: "Dashi agent sandbox <unit>", for signing leaves only (path length 0). */
export async function makeAuthority(unit: string, now = new Date()): Promise<Authority> {
  const pair = await keyPair();
  const id = await keyId(pair.spki);
  const subject = name(`Dashi agent sandbox ${unit}`.slice(0, 64));
  const notAfter = new Date(now.getTime() + CA_LIFETIME_MS);
  const tbs = sequence(
    tlv(0xa0, integer(Uint8Array.of(2))),
    serial(),
    ECDSA_SHA256,
    subject,
    sequence(time(new Date(now.getTime() - HOUR)), time(notAfter)),
    subject,
    pair.spki,
    tlv(
      0xa3,
      sequence(
        extension("2.5.29.19", true, sequence(TRUE, integer(Uint8Array.of(0)))),
        // keyCertSign and cRLSign.
        extension("2.5.29.15", true, bits(Uint8Array.of(0x06), 1)),
        extension("2.5.29.14", false, octets(id)),
      ),
    ),
  );
  const der = await sign(tbs, pair.privateKey);
  return { name: `Dashi agent sandbox ${unit}`, pair, id, cert: pem("CERTIFICATE", der), key: await privatePem(pair.privateKey), notAfter };
}

/** A server certificate for `host`, signed by `ca`. */
export async function issueLeaf(ca: Authority, host: string, now = new Date()): Promise<Issued> {
  const pair = await keyPair();
  const notAfter = new Date(Math.min(now.getTime() + LEAF_LIFETIME_MS, ca.notAfter.getTime()));
  const tbs = sequence(
    tlv(0xa0, integer(Uint8Array.of(2))),
    serial(),
    ECDSA_SHA256,
    name(ca.name.slice(0, 64)),
    sequence(time(new Date(now.getTime() - HOUR)), time(notAfter)),
    name(host.slice(0, 64)),
    pair.spki,
    tlv(
      0xa3,
      sequence(
        extension("2.5.29.19", true, sequence()),
        // digitalSignature.
        extension("2.5.29.15", true, bits(Uint8Array.of(0x80), 7)),
        extension("2.5.29.37", false, sequence(oid("1.3.6.1.5.5.7.3.1"))),
        // subjectAltName: dNSName [2], IA5String.
        extension("2.5.29.17", false, sequence(tlv(0x82, new TextEncoder().encode(host)))),
        extension("2.5.29.14", false, octets(await keyId(pair.spki))),
        extension("2.5.29.35", false, sequence(tlv(0x80, ca.id))),
      ),
    ),
  );
  const der = await sign(tbs, ca.pair.privateKey);
  return { cert: pem("CERTIFICATE", der), key: await privatePem(pair.privateKey), notAfter };
}
