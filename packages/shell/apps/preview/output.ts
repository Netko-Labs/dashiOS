/**
 * What leaves Preview: Copy (the picture, or a PDF page, as an image on the
 * clipboard), Export (a copy written where the person says, rotated as it is
 * shown), and the PDF that Print hands to the print dialog. Each is a helper
 * process on the file with structured arguments (tools.ts), written beside
 * its destination first and renamed into place, so a failed export never
 * leaves half a file.
 */

import { copyFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { FORMATS, type Format, type Kind } from "../../src/shared/files/kinds.ts";
import { cacheFile, cacheKey, partialName, type Stamp } from "./cache.ts";
import {
  CONVERT_MEMORY_MIB,
  CONVERT_TIMEOUT_MS,
  convertible,
  convertPngArgs,
  EXPORT_FORMATS,
  type ExportFormat,
  exportImageArgs,
  turnPngArgs,
} from "./convert.ts";
import { pdftoppmArgs } from "./pdf.ts";
import { type RunOptions, type RunResult, runTool } from "./tools.ts";
import { mod4 } from "./zoom.ts";

/** A PDF page exported or copied as a picture is rendered at this resolution. */
export const PAGE_DPI = 150;

/** The open file, as output needs it. */
export interface Source {
  path: string;
  kind: Kind;
  format: Format;
  stamp: Stamp;
  turns: number;
}

export interface OutputTools {
  magick: boolean;
  qpdf: boolean;
}

type Run = (argv: readonly string[], options: RunOptions) => Promise<RunResult>;

const LIMITS: Pick<RunOptions, "timeoutMs" | "memoryMiB"> = { timeoutMs: CONVERT_TIMEOUT_MS, memoryMiB: CONVERT_MEMORY_MIB };

/** The formats a file can be exported as: a PDF whole or a page as a picture; a picture ImageMagick reads, as any. */
export function exportFormats(kind: Kind | null, format: Format | null, tools: OutputTools): ExportFormat[] {
  if (kind === "pdf") return tools.magick ? ["pdf", "png", "jpeg"] : ["pdf", "png"];
  if (!format || !tools.magick || !convertible(format)) return [];
  return ["png", "jpeg", "pdf"];
}

/** The name a save dialog starts with: the file's name with the new extension (and the page, for one page of a PDF). */
export function exportName(name: string, to: ExportFormat, page: number | null): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}${page !== null ? ` page ${page}` : ""}.${EXPORT_FORMATS[to].extension}`;
}

/** `qpdf` turning every page of a PDF: arguments. */
export function qpdfRotateArgs(input: string, turns: number, output: string): string[] {
  return ["qpdf", input, `--rotate=+${mod4(turns) * 90}:1-z`, output];
}

/** A page of a PDF as a PNG at `dpi`, turned as the document is shown, in the cache. */
export async function pagePng(source: Source, page: number, dpi: number, root: string, run: Run = runTool): Promise<string | null> {
  const plain = cacheFile(root, cacheKey(source.stamp, `pdf:${page}:${dpi}`), "png");
  if (!(await Bun.file(plain).exists())) {
    const base = partialName(join(root, cacheKey(source.stamp, `pdf:${page}:${dpi}`)));
    const result = await run(pdftoppmArgs(source.path, page, dpi, base), { timeoutMs: 45_000, memoryMiB: 2048 });
    if (!result.ok || !(await Bun.file(`${base}.png`).exists())) return null;
    await rename(`${base}.png`, plain);
  }
  if (mod4(source.turns) === 0) return plain;
  const out = cacheFile(root, cacheKey(source.stamp, `pdf:${page}:${dpi}:t${mod4(source.turns)}`), "png");
  if (await Bun.file(out).exists()) return out;
  const partial = partialName(out);
  const result = await run(turnPngArgs(plain, source.turns, partial), LIMITS);
  if (!result.ok) return null;
  await rename(partial, out);
  return out;
}

/** The PDF Print hands over: the file itself, or a rotated copy, or a picture made into one; null when it can't be made. */
export async function printablePdf(source: Source, root: string, tools: OutputTools, run: Run = runTool): Promise<string | null> {
  const out = cacheFile(root, cacheKey(source.stamp, `print:${mod4(source.turns)}`), "pdf");
  if (source.kind === "pdf") {
    if (mod4(source.turns) === 0 || !tools.qpdf) return source.path;
    if (await Bun.file(out).exists()) return out;
    const partial = partialName(out);
    const result = await run(qpdfRotateArgs(source.path, source.turns, partial), LIMITS);
    if (!result.ok) return source.path;
    await rename(partial, out);
    return out;
  }
  if (await Bun.file(out).exists()) return out;
  const partial = partialName(out);
  const args = tools.magick ? exportImageArgs(source.format, source.turns, "pdf", 92, partial) : null;
  if (!args) return null;
  const result = await run(args, { ...LIMITS, input: Bun.file(source.path) });
  if (!result.ok || !(await Bun.file(partial).exists())) return null;
  await rename(partial, out);
  return out;
}

export interface ExportRequest {
  to: ExportFormat;
  /** 1 to 100, for JPEG. */
  quality: number;
  /** For a PDF exported as a picture: the page. */
  page: number;
  /** Where the person said (the save dialog asked about replacing a file there). */
  target: string;
}

/** What an export did: written (and whether a PDF lost its rotation on the way), or failed. */
export type ExportResult = { ok: true; unrotated: boolean } | { ok: false };

/** Writes the export at `request.target`, through a file beside it renamed into place. */
export async function exportFile(source: Source, request: ExportRequest, root: string, tools: OutputTools, run: Run = runTool): Promise<ExportResult> {
  const partial = partialName(request.target);
  const done = async (ok: boolean, unrotated = false): Promise<ExportResult> => {
    if (ok) {
      try {
        await rename(partial, request.target);
        return { ok: true, unrotated };
      } catch {
        // Fall through to clean up.
      }
    }
    await rm(partial, { force: true });
    return { ok: false };
  };
  try {
    if (source.kind === "pdf" && request.to === "pdf") {
      if (mod4(source.turns) !== 0 && tools.qpdf) return done((await run(qpdfRotateArgs(source.path, source.turns, partial), LIMITS)).ok);
      await copyFile(source.path, partial);
      return done(true, mod4(source.turns) !== 0);
    }
    if (source.kind === "pdf") {
      const page = await pagePng(source, request.page, PAGE_DPI, root, run);
      if (!page) return done(false);
      if (request.to === "png") {
        await copyFile(page, partial);
        return done(true);
      }
      return done((await run(convertPngArgs(page, request.to, request.quality, partial), LIMITS)).ok);
    }
    const args = exportImageArgs(source.format, source.turns, request.to, request.quality, partial);
    if (!args) return done(false);
    return done((await run(args, { ...LIMITS, input: Bun.file(source.path) })).ok);
  } catch {
    return done(false);
  }
}

/** The MIME type of a picture Preview draws from: the file's own when it is drawn as it is, else PNG (a converted copy). */
export const pictureMime = (source: string, original: string, format: Format): string => (source === original ? FORMATS[format].mime : "image/png");
