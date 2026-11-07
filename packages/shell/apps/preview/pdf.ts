/**
 * PDFs through poppler: `pdfinfo` for the page count and every page's size,
 * `pdftoppm` for a page as a PNG at a resolution, `pdftotext` for a page's
 * words and their boxes (text.ts). A PDF is untrusted, so the page count and
 * the pixels of one render are capped, and a render is one process with a
 * time limit (tools.ts).
 */

import type { Size } from "./dimensions.ts";

export interface PdfInfo {
  pages: number;
  title: string | null;
  encrypted: boolean;
  /** The first page's size in points (1/72 inch), as it is shown (rotation applied). */
  pageSize: Size | null;
  /** Every page's size as it is shown (`pdfinfoArgs` asks for all of them). */
  pageSizes: Size[];
}

/** A document with more pages than this is opened but only this many are reachable. */
export const MAX_PAGES = 5000;
/** The longest side, in pixels, of one rendered page. */
export const MAX_RENDER_SIDE = 6000;
/** Thumbnails are drawn 150 wide in the page strip: twice that, so they are sharp on a HiDPI screen. */
export const THUMBNAIL_WIDTH = 300;
/** A letter page, for a page pdfinfo didn't measure. */
const LETTER: Size = { width: 612, height: 792 };

/** What `pdfinfo` printed, as data. Null when it did not describe a document. */
export function parsePdfInfo(stdout: string): PdfInfo | null {
  const field = (name: string): string | undefined => new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(stdout)?.[1]?.trim();
  const pages = Number(field("Pages"));
  if (!Number.isInteger(pages) || pages < 1) return null;
  const sizes = pageSizes(stdout, Math.min(pages, MAX_PAGES));
  const measured = /^(?:Page\s+1\s+size|Page size):\s*[0-9.]+\s*x\s*[0-9.]+\s*pts/m.test(stdout);
  const title = field("Title");
  return {
    pages: Math.min(pages, MAX_PAGES),
    title: title ? title : null,
    encrypted: /^yes/i.test(field("Encrypted") ?? ""),
    pageSize: measured ? (sizes[0] ?? null) : null,
    pageSizes: sizes,
  };
}

const positive = (width: number, height: number): Size | null =>
  width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;

/**
 * Each page's size from pdfinfo's `Page N size:` and `Page N rot:` lines (or
 * a lone `Page size:`), turned by the page's own rotation, since pdftoppm
 * draws it turned. A page pdfinfo didn't list takes the size of the one
 * before it.
 */
export function pageSizes(stdout: string, pages: number): Size[] {
  const sizes = new Map<number, Size>();
  const turns = new Map<number, number>();
  for (const match of stdout.matchAll(/^Page\s+(\d+)\s+size:\s*([0-9.]+)\s*x\s*([0-9.]+)\s*pts/gm)) {
    const size = positive(Number(match[2]), Number(match[3]));
    if (size) sizes.set(Number(match[1]), size);
  }
  const single = /^Page size:\s*([0-9.]+)\s*x\s*([0-9.]+)\s*pts/m.exec(stdout);
  const fallback = single ? positive(Number(single[1]), Number(single[2])) : null;
  if (fallback && !sizes.has(1)) sizes.set(1, fallback);
  for (const match of stdout.matchAll(/^Page\s+(\d+)\s+rot:\s*(-?\d+)/gm)) turns.set(Number(match[1]), Number(match[2]));
  const singleTurn = /^Page rot:\s*(-?\d+)/m.exec(stdout);
  if (singleTurn && !turns.has(1)) turns.set(1, Number(singleTurn[1]));
  const out: Size[] = [];
  let last = LETTER;
  for (let page = 1; page <= pages; page++) {
    const size = sizes.get(page);
    if (size) {
      const quarter = (((turns.get(page) ?? 0) % 360) + 360) % 360;
      last = quarter === 90 || quarter === 270 ? { width: size.height, height: size.width } : size;
    }
    out.push(last);
  }
  return out;
}

/** Whether poppler's complaint means the document wants a password. */
export const wantsPassword = (stderr: string): boolean => /incorrect password|password/i.test(stderr);

/** `pdfinfo` for every page's size: arguments. The path must be absolute so it cannot read as an option. */
export function pdfinfoArgs(path: string, pages: number = MAX_PAGES): string[] {
  return ["pdfinfo", "-f", "1", "-l", String(pages), path];
}

/** `pdftotext` for one page's words and their boxes, on standard output. */
export function pdftotextArgs(pdf: string, page: number): string[] {
  return ["pdftotext", "-bbox-layout", "-enc", "UTF-8", "-f", String(page), "-l", String(page), pdf, "-"];
}

/** `pdftotext` for the plain text of pages `from` to `to`, on standard output. */
export function plainTextArgs(pdf: string, from: number, to: number): string[] {
  return ["pdftotext", "-enc", "UTF-8", "-f", String(from), "-l", String(to), pdf, "-"];
}

/** The resolutions pages are rendered at, so a few zoom levels share a render. */
export const DPI_STEPS: readonly number[] = [24, 36, 54, 72, 96, 144, 192, 288, 384, 576];

/**
 * The resolution for a page shown at `scale` logical pixels per point on a
 * display with `deviceScale`: the first step that is sharp enough, held under
 * the pixel cap for a page of `pagePts` points.
 */
export function chooseDpi(scale: number, deviceScale: number, pagePts: Size): number {
  const wanted = scale * deviceScale * 72;
  const longest = Math.max(pagePts.width, pagePts.height, 1);
  const ceiling = (MAX_RENDER_SIDE * 72) / longest;
  const step = DPI_STEPS.find((dpi) => dpi >= wanted * 0.98) ?? (DPI_STEPS.at(-1) as number);
  return Math.max(DPI_STEPS[0] as number, Math.floor(Math.min(step, ceiling)));
}

/** `pdftoppm` for one page as `<outputBase>.png` (or `.jpg`) at `dpi`. Both paths are absolute. */
export function pdftoppmArgs(pdf: string, page: number, dpi: number, outputBase: string, format: "png" | "jpeg" = "png", quality = 92): string[] {
  const kind = format === "png" ? ["-png"] : ["-jpeg", "-jpegopt", `quality=${Math.round(Math.min(100, Math.max(1, quality)))}`];
  return ["pdftoppm", ...kind, "-singlefile", "-r", String(Math.round(dpi)), "-f", String(page), "-l", String(page), pdf, outputBase];
}

/** `pdftoppm` for a page's thumbnail, `THUMBNAIL_WIDTH` pixels wide. */
export function thumbnailArgs(pdf: string, page: number, outputBase: string): string[] {
  return [
    "pdftoppm",
    "-png",
    "-singlefile",
    "-scale-to-x",
    String(THUMBNAIL_WIDTH),
    "-scale-to-y",
    "-1",
    "-f",
    String(page),
    "-l",
    String(page),
    pdf,
    outputBase,
  ];
}
