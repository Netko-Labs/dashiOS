/**
 * Bytes on disk ↔ the text being edited. A file is read as UTF-8 (with or
 * without a byte-order mark), UTF-16 when it starts with one's mark, and
 * otherwise as ISO-8859-1, which any byte sequence is. Line endings are
 * edited as `\n` and written back the way the file had them (the most common
 * kind wins in a mixed file). A file with NUL bytes and no UTF-16 mark is not
 * text. Saving keeps the encoding; a character it cannot hold makes the
 * encoder say so (null) and the caller saves UTF-8 instead.
 */

export type Encoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "latin-1";
export type LineEnding = "lf" | "crlf" | "cr";

export interface Decoded {
  /** With `\n` line endings. */
  text: string;
  encoding: Encoding;
  lineEnding: LineEnding;
}

export const ENCODING_LABELS: Readonly<Record<Encoding, string>> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 with BOM",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  "latin-1": "ISO-8859-1",
};

export const LINE_ENDING_LABELS: Readonly<Record<LineEnding, string>> = { lf: "LF", crlf: "CRLF", cr: "CR" };

/** The kind of line ending `raw` uses most; LF when it has none or on a tie with LF. */
export function detectLineEnding(raw: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 13) {
      if (raw.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (code === 10) lf++;
  }
  if (crlf > lf && crlf >= cr) return "crlf";
  if (cr > lf && cr > crlf) return "cr";
  return "lf";
}

/** Every `\r\n` and lone `\r` as `\n`. */
export function normalizeLineEndings(raw: string): string {
  return raw.replace(/\r\n?/g, "\n");
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const units = new Uint16Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < units.length; i++) units[i] = view.getUint16(i * 2, littleEndian);
  // Chunked so a large file does not overflow the argument list.
  let out = "";
  for (let i = 0; i < units.length; i += 8192) out += String.fromCharCode(...units.subarray(i, i + 8192));
  return out;
}

function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

function decodeRaw(bytes: Uint8Array): { raw: string; encoding: Encoding } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { raw: decodeUtf16(bytes.subarray(2), true), encoding: "utf-16le" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { raw: decodeUtf16(bytes.subarray(2), false), encoding: "utf-16be" };
  if (bytes.includes(0)) return null;
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
    return { raw, encoding: bom ? "utf-8-bom" : "utf-8" };
  } catch {
    return { raw: decodeLatin1(bytes), encoding: "latin-1" };
  }
}

/** The file's text, or null when it is not text. */
export function decodeText(bytes: Uint8Array): Decoded | null {
  const decoded = decodeRaw(bytes);
  if (!decoded) return null;
  return { text: normalizeLineEndings(decoded.raw), encoding: decoded.encoding, lineEnding: detectLineEnding(decoded.raw) };
}

const ENDINGS: Readonly<Record<LineEnding, string>> = { lf: "\n", crlf: "\r\n", cr: "\r" };

function encodeUtf16(text: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0xfeff, littleEndian);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), littleEndian);
  return out;
}

/** `text` (with `\n` endings) as bytes in `encoding` with `lineEnding`; null when the encoding can't hold a character. */
export function encodeText(text: string, encoding: Encoding, lineEnding: LineEnding): Uint8Array | null {
  const raw = lineEnding === "lf" ? text : text.replace(/\n/g, ENDINGS[lineEnding]);
  switch (encoding) {
    case "utf-8":
      return new TextEncoder().encode(raw);
    case "utf-8-bom": {
      const body = new TextEncoder().encode(raw);
      const out = new Uint8Array(body.length + 3);
      out.set([0xef, 0xbb, 0xbf]);
      out.set(body, 3);
      return out;
    }
    case "utf-16le":
      return encodeUtf16(raw, true);
    case "utf-16be":
      return encodeUtf16(raw, false);
    case "latin-1": {
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        const code = raw.charCodeAt(i);
        if (code > 0xff) return null;
        out[i] = code;
      }
      return out;
    }
  }
}
