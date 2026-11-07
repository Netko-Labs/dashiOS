/**
 * Bytes on disk ↔ the text being edited. A file is read as UTF-8 (with or
 * without a byte-order mark), UTF-16 when it starts with one's mark, and
 * otherwise as Windows-1252, which any byte sequence is and which keeps the
 * curly quotes and dashes of files from Windows (ISO-8859-1 would make them
 * invisible control characters). Line endings are
 * edited as `\n` and written back the way the file had them (the most common
 * kind wins in a mixed file). A file with NUL bytes and no UTF-16 mark is not
 * text. Saving keeps the encoding; a character it cannot hold makes the
 * encoder say so (null) and the caller saves UTF-8 instead.
 */

/** `latin-1` is only ever read back from a draft kept by an earlier Text Editor. */
export type Encoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "windows-1252" | "latin-1";
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
  "windows-1252": "Western (Windows)",
  "latin-1": "Western (ISO-8859-1)",
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

/** Windows-1252's bytes 0x80 to 0x9F; the five it leaves out stand for themselves, as in browsers. */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d,
  0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
] as const;
const CP1252_BYTES: ReadonlyMap<number, number> = new Map(CP1252_HIGH.map((code, index) => [code, 0x80 + index]));

function decodeWindows1252(bytes: Uint8Array): string {
  const codes = new Uint16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    codes[i] = byte >= 0x80 && byte < 0xa0 ? (CP1252_HIGH[byte - 0x80] as number) : byte;
  }
  let out = "";
  for (let i = 0; i < codes.length; i += 8192) out += String.fromCharCode(...codes.subarray(i, i + 8192));
  return out;
}

/** One character's byte in Windows-1252, or null when it has none. */
function windows1252Byte(code: number): number | null {
  if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) return code;
  return CP1252_BYTES.get(code) ?? null;
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
    return { raw: decodeWindows1252(bytes), encoding: "windows-1252" };
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
    case "windows-1252": {
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        const byte = windows1252Byte(raw.charCodeAt(i));
        if (byte === null) return null;
        out[i] = byte;
      }
      return out;
    }
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
