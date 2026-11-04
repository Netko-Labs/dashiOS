/**
 * PDFs through poppler: `pdfinfo` for the page count and size, `pdftoppm`
 * for a page as a PNG at a resolution. A PDF is untrusted, so the page count
 * and the pixels of one render are capped, and a render is one process with a
 * time limit (tools.ts).
 */

export interface PdfInfo {
  pages: number;
  title: string | null;
  encrypted: boolean;
  /** The first page's size in points (1/72 inch), as it is shown (rotation applied). */
  pageSize: { width: number; height: number } | null;
}

/** A document with more pages than this is opened but only this many are reachable. */
export const MAX_PAGES = 5000;
/** The longest side, in pixels, of one rendered page. */
export const MAX_RENDER_SIDE = 6000;
export const THUMBNAIL_WIDTH = 220;

/** What `pdfinfo` printed, as data. Null when it did not describe a document. */
export function parsePdfInfo(stdout: string): PdfInfo | null {
  const field = (name: string): string | undefined => new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(stdout)?.[1]?.trim();
  const pages = Number(field("Pages"));
  if (!Number.isInteger(pages) || pages < 1) return null;
  const size = /^(?:Page\s+1\s+size|Page size):\s*([0-9.]+)\s*x\s*([0-9.]+)\s*pts/m.exec(stdout);
  const width = size ? Number(size[1]) : 0;
  const height = size ? Number(size[2]) : 0;
  const title = field("Title");
  return {
    pages: Math.min(pages, MAX_PAGES),
    title: title ? title : null,
    encrypted: /^yes/i.test(field("Encrypted") ?? ""),
    pageSize: width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null,
  };
}

/** Whether poppler's complaint means the document wants a password. */
export const wantsPassword = (stderr: string): boolean => /incorrect password|password/i.test(stderr);

/** `pdfinfo` for page 1: arguments. The path must be absolute so it cannot read as an option. */
export function pdfinfoArgs(path: string): string[] {
  return ["pdfinfo", "-f", "1", "-l", "1", path];
}

/** The resolutions pages are rendered at, so a few zoom levels share a render. */
export const DPI_STEPS: readonly number[] = [24, 36, 54, 72, 96, 144, 192, 288, 384, 576];

/**
 * The resolution for a page shown at `scale` logical pixels per point on a
 * display with `deviceScale`: the first step that is sharp enough, held under
 * the pixel cap for a page of `pagePts` points.
 */
export function chooseDpi(scale: number, deviceScale: number, pagePts: { width: number; height: number }): number {
  const wanted = scale * deviceScale * 72;
  const longest = Math.max(pagePts.width, pagePts.height, 1);
  const ceiling = (MAX_RENDER_SIDE * 72) / longest;
  const step = DPI_STEPS.find((dpi) => dpi >= wanted * 0.98) ?? (DPI_STEPS.at(-1) as number);
  return Math.max(DPI_STEPS[0] as number, Math.floor(Math.min(step, ceiling)));
}

/** `pdftoppm` for one page as `<outputBase>.png` at `dpi`. Both paths are absolute. */
export function pdftoppmArgs(pdf: string, page: number, dpi: number, outputBase: string): string[] {
  return ["pdftoppm", "-png", "-singlefile", "-r", String(Math.round(dpi)), "-f", String(page), "-l", String(page), pdf, outputBase];
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
