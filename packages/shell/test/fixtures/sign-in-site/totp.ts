/** RFC 6238 TOTP for the test site, on WebCrypto (dashi-secretd has its own, in Rust). */

export async function hotp(key: Uint8Array, counter: number, digits = 6, hash: "SHA-1" | "SHA-256" | "SHA-512" = "SHA-1"): Promise<string> {
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const imported = await crypto.subtle.importKey("raw", new Uint8Array(key), { name: "HMAC", hash }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", imported, message));
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const totp = (key: Uint8Array, unixSeconds: number, digits = 6, hash: "SHA-1" | "SHA-256" | "SHA-512" = "SHA-1"): Promise<string> =>
  hotp(key, Math.floor(unixSeconds / 30), digits, hash);

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
