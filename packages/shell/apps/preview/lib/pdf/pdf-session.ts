/**
 * A PDF the viewer has open: its probe (pdfinfo's page count, title and
 * sizes, or why it can't be shown), its pages (pdf-doc.ts renders them as
 * they come near the screen), and the plain text of a run of pages for a copy.
 * The viewer (viewer.ts) owns the file's state and says what the window shows.
 */

import type { Stamp } from "../cache.ts";
import type { Size } from "../dimensions.ts";
import { MESSAGES } from "../messages.ts";
import type { PdfState } from "../snapshot.ts";
import type { PageText } from "../text.ts";
import { runTool } from "../tools.ts";
import { turned } from "../zoom.ts";
import { parsePdfInfo, pdfinfoArgs, plainTextArgs, wantsPassword } from "./pdf.ts";
import { PdfPages } from "./pdf-doc.ts";

const INFO_TIMEOUT_MS = 30_000;

export interface PdfProbe {
  pages: number;
  title: string | null;
  sizes: Size[];
}

export interface PdfStart {
  path: string;
  stamp: Stamp;
  root: string;
  deviceScale: number;
  turns: number;
  onChange: () => void;
}

/** What pdfinfo says about a PDF, or the message that says why it can't be shown. */
export async function probePdf(path: string): Promise<{ ok: true; probe: PdfProbe } | { ok: false; message: string }> {
  const info = await runTool(pdfinfoArgs(path), { timeoutMs: INFO_TIMEOUT_MS, memoryMiB: 1024, maxOutput: 2 * 1024 * 1024 });
  const parsed = info.ok ? parsePdfInfo(info.stdout) : null;
  if (!parsed) return { ok: false, message: wantsPassword(info.stderr) ? MESSAGES.locked : MESSAGES.damagedPdf };
  if (parsed.encrypted && !parsed.pageSize) return { ok: false, message: MESSAGES.locked };
  return { ok: true, probe: { pages: parsed.pages, title: parsed.title, sizes: parsed.pageSizes } };
}

/** Pages `from` to `to` as plain text; empty when they can't be read. */
export async function plainTextOf(path: string, from: number, to: number): Promise<string> {
  const result = await runTool(plainTextArgs(path, from, to), { timeoutMs: INFO_TIMEOUT_MS * 4, memoryMiB: 1024, maxOutput: 64 * 1024 * 1024 });
  // pdftotext ends each page with a form feed.
  return result.ok ? result.stdout.replaceAll("\f", "\n\n") : "";
}

export class PdfSession {
  private pages: PdfPages | null = null;
  private base: { pages: number; title: string | null; sizes: Size[] } | null = null;

  /** Start the pages of a probed PDF, turned `turns` quarters. */
  start(probe: PdfProbe, start: PdfStart): void {
    this.base = { pages: probe.pages, title: probe.title, sizes: probe.sizes };
    this.pages = new PdfPages({
      path: start.path,
      stamp: start.stamp,
      root: start.root,
      sizes: probe.sizes,
      deviceScale: start.deviceScale,
      turns: start.turns,
      onChange: start.onChange,
    });
  }

  close(): void {
    this.pages?.close();
    this.pages = null;
    this.base = null;
  }

  /** Turn the open PDF's pages; false when no PDF is open. */
  setTurns(turns: number): boolean {
    if (!this.pages || !this.base) return false;
    this.pages.setTurns(turns);
    return true;
  }

  /** The state the window draws, its sizes turned `turns` quarters; null while no PDF is open. */
  state(turns: number): PdfState | null {
    const base = this.base;
    if (!base || !this.pages) return null;
    return { ...base, sizes: base.sizes.map((size) => turned(size, turns)), ...this.pages.state };
  }

  /** The pages near the screen at `scale` (logical pixels per point), and the strip's thumbnails. */
  want(pages: readonly number[], scale: number, thumbs: readonly number[]): void {
    this.pages?.want(pages, scale, thumbs);
  }

  /** A page's words, for a drag that selects text on it. */
  wantText(page: number): void {
    this.pages?.wantText(page);
  }

  /** The words of `pages`, read now where they aren't yet. */
  async textOf(pages: readonly number[]): Promise<ReadonlyMap<number, PageText>> {
    return this.pages ? this.pages.textOf(pages) : new Map();
  }

  /** The resolution a page is rendered at for `scale`; 144 while no PDF is open. */
  dpiFor(page: number, scale: number): number {
    return this.pages?.dpiFor(page, scale) ?? 144;
  }
}
