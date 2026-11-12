/**
 * What Preview opens. A file's kind comes from its name (cheap, for a folder
 * listing); the format it really is comes from its first bytes (`sniff`),
 * which is what decides how it is drawn, since a name can lie.
 */

import { extname } from "node:path";

export type Kind = "image" | "pdf";

/** Formats Preview names. `svg` and the first six are drawn as they are; `converted` ones need ImageMagick. */
export type Format = "png" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "svg" | "heic" | "avif" | "jxl" | "pdf";

interface FormatInfo {
  kind: Kind;
  mime: string;
  label: string;
  /** The ImageMagick coder name, for the formats it reads; absent for ones it must not (SVG, PDF). */
  coder?: string;
  /** Metal's image loader draws it without help. */
  native: boolean;
}

export const FORMATS: Readonly<Record<Format, FormatInfo>> = {
  png: { kind: "image", mime: "image/png", label: "PNG image", coder: "png", native: true },
  jpeg: { kind: "image", mime: "image/jpeg", label: "JPEG image", coder: "jpeg", native: true },
  gif: { kind: "image", mime: "image/gif", label: "GIF image", coder: "gif", native: true },
  webp: { kind: "image", mime: "image/webp", label: "WebP image", coder: "webp", native: true },
  bmp: { kind: "image", mime: "image/bmp", label: "BMP image", coder: "bmp", native: true },
  tiff: { kind: "image", mime: "image/tiff", label: "TIFF image", coder: "tiff", native: true },
  svg: { kind: "image", mime: "image/svg+xml", label: "SVG image", native: true },
  heic: { kind: "image", mime: "image/heic", label: "HEIC image", coder: "heic", native: false },
  avif: { kind: "image", mime: "image/avif", label: "AVIF image", coder: "avif", native: false },
  jxl: { kind: "image", mime: "image/jxl", label: "JPEG XL image", coder: "jxl", native: false },
  pdf: { kind: "pdf", mime: "application/pdf", label: "PDF document", native: false },
};

const EXTENSIONS: Readonly<Record<string, Format>> = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".jpe": "jpeg",
  ".jfif": "jpeg",
  ".gif": "gif",
  ".webp": "webp",
  ".bmp": "bmp",
  ".tif": "tiff",
  ".tiff": "tiff",
  ".svg": "svg",
  ".heic": "heic",
  ".heif": "heic",
  ".avif": "avif",
  ".jxl": "jxl",
  ".pdf": "pdf",
};

/** The format a file name suggests, or null. */
export function formatFromName(name: string): Format | null {
  return EXTENSIONS[extname(name).toLowerCase()] ?? null;
}

/** The kind of a file name (image or PDF), or null when Preview does not open it. */
export function kindOf(name: string): Kind | null {
  const format = formatFromName(name);
  return format ? FORMATS[format].kind : null;
}

const ascii = (bytes: Uint8Array, at: number, text: string): boolean => [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0));

/**
 * What a file Preview can't show is, for Open With: plain text when its
 * first bytes read as text (no NULs, UTF-8), else the type its name says
 * when that isn't one of Preview's own (a name that lies about being a
 * picture says nothing). Null when neither tells.
 */
export function otherMime(head: Uint8Array, name: string): string | null {
  if (head.length > 0 && !head.includes(0)) {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    // The head may end inside a character: up to three bytes short of it.
    for (let cut = 0; cut <= Math.min(3, head.length - 1); cut++) {
      try {
        decoder.decode(head.subarray(0, head.length - cut));
        return "text/plain";
      } catch {
        // Try a byte shorter.
      }
    }
  }
  if (formatFromName(name)) return null;
  const type = Bun.file(name).type.split(";")[0]?.trim() ?? "";
  return type !== "" && type !== "application/octet-stream" ? type : null;
}

/** The format the first bytes of a file say it is, or null. SVG is recognised by its `<svg` element near the start. */
export function sniff(head: Uint8Array): Format | null {
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, "PNG\r\n") && head[6] === 0x1a && head[7] === 0x0a) return "png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (ascii(head, 0, "GIF87a") || ascii(head, 0, "GIF89a")) return "gif";
  if (head.length >= 12 && ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) return "webp";
  if (ascii(head, 0, "BM") && head.length >= 26) return "bmp";
  if ((ascii(head, 0, "II") && head[2] === 42 && head[3] === 0) || (ascii(head, 0, "MM") && head[2] === 0 && head[3] === 42)) return "tiff";
  if (ascii(head, 0, "%PDF-")) return "pdf";
  if (head.length >= 12 && ascii(head, 4, "ftyp")) {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    if (brand === "avif" || brand === "avis") return "avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(brand)) return "heic";
  }
  if ((head[0] === 0xff && head[1] === 0x0a) || ascii(head, 0, "\0\0\0\fJXL ")) return "jxl";
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head.subarray(0, 2048));
  if (/<svg[\s>]/i.test(text) && /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text))
    return "svg";
  return null;
}
