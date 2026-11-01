/**
 * The viewer's state and everything slow it does: reading a file's header,
 * preparing a picture Metal can draw (converting or turning it with
 * ImageMagick when it must), asking poppler for a PDF's pages and
 * thumbnails, and moving through the folder. The window (view.tsx) only
 * subscribes to `getSnapshot()` and calls these methods.
 *
 * Every open is a new generation: work that finishes for an older one is
 * dropped, so a quick run of arrow presses never paints a stale picture.
 */

import { closeSync, existsSync, linkSync, openSync, readSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { cacheFile, cacheKey, cacheRoot, ensureCache, partialName, publish, type Stamp } from "./cache.ts";
import { canSaveCopy, CONVERT_MEMORY_MIB, CONVERT_TIMEOUT_MS, convertible, copyName, MAX_NATIVE_PIXELS, magickArgs, REDUCED_PIXELS, saveCopyArgs } from "./convert.ts";
import { HEADER_BYTES, jpegOrientation, readSize, type Size, swapsSides } from "./dimensions.ts";
import { FORMATS, type Format, formatFromName, type Kind, sniff } from "./kinds.ts";
import { chooseDpi, MAX_PAGES, parsePdfInfo, pdfinfoArgs, pdftoppmArgs, thumbnailArgs, wantsPassword } from "./pdf.ts";
import { type Neighbours, siblingPath, siblingsOf } from "./siblings.ts";
import { haveTool, runTool } from "./tools.ts";
import { mod4 } from "./zoom.ts";

/** Files over this are not opened at all. */
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const THUMB_LIMIT = 600;
const THUMB_WORKERS = 2;
const RENDER_TIMEOUT_MS = 45_000;
const INFO_TIMEOUT_MS = 15_000;

export interface Picture {
  /** The file Metal draws. */
  source: string;
  /** Its size: pixels for an image, points for a PDF page (the picture is drawn at points × scale). */
  width: number;
  height: number;
}

export interface PdfState {
  pages: number;
  page: number;
  title: string | null;
  thumbs: ReadonlyMap<number, string>;
}

export interface Snapshot {
  phase: "empty" | "loading" | "ready" | "error";
  error: string | null;
  path: string | null;
  name: string;
  kind: Kind | null;
  format: Format | null;
  picture: Picture | null;
  /** Pixels of the file as stored, after the EXIF turn (what the info sheet says). */
  natural: Size | null;
  turns: number;
  /** The view can be turned (ImageMagick is there and the format allows it). */
  canTurn: boolean;
  canSave: boolean;
  /** The file carries an EXIF turn, so a copy saved from it comes out upright. */
  exifTurn: boolean;
  folder: Neighbours & { dir: string };
  pdf: PdfState | null;
  busy: boolean;
  /** A line about what was done to show it ("Reduced to fit"). */
  note: string | null;
  tools: { magick: boolean; poppler: boolean };
  stamp: Stamp | null;
  rev: number;
}

const EMPTY_FOLDER: Snapshot["folder"] = { dir: "", index: -1, count: 0, previous: null, next: null };

export class Viewer {
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private readonly root: string;
  private head: Uint8Array = new Uint8Array();
  private orientation = 1;
  private storedSize: Size | null = null;
  private inflight = new Map<string, Promise<string | null>>();
  private wantedDpi = 144;
  private lastShownDpi = 0;
  private pagePoints: { width: number; height: number } | null = null;
  private thumbQueue: number[] = [];
  private thumbWorkers = 0;
  private readonly thumbs = new Map<number, string>();
  private readonly deviceScale: number;

  constructor(options: { cacheDir?: string; deviceScale?: number } = {}) {
    this.root = options.cacheDir ?? cacheRoot();
    this.deviceScale = options.deviceScale ?? 2;
    try {
      ensureCache(this.root);
    } catch {
      // Without a cache nothing needing a conversion or a render works; the open says so.
    }
    this.snapshot = {
      phase: "empty",
      error: null,
      path: null,
      name: "",
      kind: null,
      format: null,
      picture: null,
      natural: null,
      turns: 0,
      canTurn: false,
      canSave: false,
      exifTurn: false,
      folder: EMPTY_FOLDER,
      pdf: null,
      busy: false,
      note: null,
      tools: { magick: haveTool("magick"), poppler: haveTool("pdftoppm") && haveTool("pdfinfo") },
      stamp: null,
      rev: 0,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  private set(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, rev: this.snapshot.rev + 1 };
    for (const listener of this.listeners) listener();
  }

  /** Open a file. A path that is not absolute is made so against the working folder. */
  async open(input: string): Promise<void> {
    const path = resolve(input);
    const generation = ++this.generation;
    this.thumbQueue = [];
    this.thumbs.clear();
    this.pagePoints = null;
    this.set({ phase: "loading", error: null, path, name: basename(path), picture: null, pdf: null, turns: 0, busy: true, note: null, natural: null, canTurn: false, canSave: false, exifTurn: false, kind: null, format: null });
    const fail = (message: string): void => {
      if (generation === this.generation) this.set({ phase: "error", error: message, busy: false, picture: null, pdf: null });
    };
    let stamp: Stamp;
    try {
      const stat = statSync(path);
      if (!stat.isFile()) return fail("This is not a file.");
      if (stat.size > MAX_FILE_BYTES) return fail("This file is too large to open here.");
      stamp = { path, mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      return fail("The file could not be found, or you do not have access to it.");
    }
    let head: Uint8Array;
    try {
      head = new Uint8Array(await Bun.file(path).slice(0, HEADER_BYTES).arrayBuffer());
    } catch {
      return fail("The file could not be read.");
    }
    if (generation !== this.generation) return;
    const format = sniff(head);
    if (!format) {
      const named = formatFromName(path);
      return fail(named ? "The file does not look like the kind of file its name says." : "Preview does not open this kind of file.");
    }
    const kind = FORMATS[format].kind;
    this.head = head;
    this.set({ kind, format, stamp });
    this.refreshFolder(path, kind);
    if (kind === "pdf") await this.openPdf(path, generation);
    else await this.openImage(path, stamp, format, generation);
  }

  private refreshFolder(path: string, kind: Kind): void {
    // A PDF steps through pages, not through the folder; an image through the folder's images.
    const listing = kind === "image" ? siblingsOf(path, "image") : { dir: dirname(path), files: [], index: -1, count: 0, previous: null, next: null };
    this.set({ folder: { dir: listing.dir, index: listing.index, count: listing.count, previous: listing.previous, next: listing.next } });
  }

  // --- Images ---------------------------------------------------------------

  private async openImage(path: string, stamp: Stamp, format: Format, generation: number): Promise<void> {
    this.orientation = format === "jpeg" ? jpegOrientation(this.head) : 1;
    const stored = readSize(format, this.head);
    this.storedSize = stored;
    const natural = stored ? (swapsSides(this.orientation) ? { width: stored.height, height: stored.width } : stored) : null;
    const canTurn = this.snapshot.tools.magick && convertible(format);
    this.set({ natural, canTurn, canSave: canTurn && canSaveCopy(format), exifTurn: this.orientation !== 1 });
    await this.prepareImage(path, stamp, format, 0, generation);
  }

  private async prepareImage(path: string, stamp: Stamp, format: Format, turns: number, generation: number): Promise<void> {
    const natural = this.snapshot.natural;
    const pixels = natural ? natural.width * natural.height : 0;
    // A GIF is shown as its first frame (Metal would play it, holding every frame in memory).
    const needsWork = !FORMATS[format].native || this.orientation !== 1 || turns !== 0 || pixels > MAX_NATIVE_PIXELS || format === "gif";
    const { magick } = this.snapshot.tools;
    if (!needsWork || !convertible(format) || !magick) {
      if (!FORMATS[format].native) return this.fail(generation, `${FORMATS[format].label.replace(" image", "")} files need ImageMagick with ${format.toUpperCase()} support, which is not installed.`);
      if (pixels > MAX_NATIVE_PIXELS) return this.fail(generation, "This picture is too large to show without ImageMagick (install it to see a reduced copy).");
      const size = natural ?? this.storedSize;
      if (!size) return this.fail(generation, "The picture's size could not be read.");
      const note = this.orientation !== 1 && format !== "svg" ? "The picture's own rotation is not applied (ImageMagick is not installed)." : null;
      if (generation === this.generation) this.set({ phase: "ready", busy: false, picture: { source: path, ...size }, turns, note });
      return;
    }
    this.set({ busy: true });
    const key = cacheKey(stamp, `img:${format}:${mod4(turns)}:${REDUCED_PIXELS}`);
    const out = cacheFile(this.root, key, "png");
    const made = await this.once(key, async () => {
      if (existsSync(out)) return out;
      const partial = partialName(out);
      const args = magickArgs({ format, turns, maxPixels: REDUCED_PIXELS, output: partial });
      if (!args) return null;
      const result = await runTool(args, { timeoutMs: CONVERT_TIMEOUT_MS, memoryMiB: CONVERT_MEMORY_MIB, input: Bun.file(path) });
      if (!result.ok || !existsSync(partial)) return null;
      publish(partial, out);
      return out;
    });
    if (generation !== this.generation) return;
    if (!made) return this.fail(generation, "The picture could not be converted (it may be damaged).");
    const size = pngSize(made);
    if (!size) return this.fail(generation, "The converted picture could not be read.");
    const reduced = natural && (size.width < (mod4(turns) % 2 ? natural.height : natural.width) || size.height < (mod4(turns) % 2 ? natural.width : natural.height));
    this.set({
      phase: "ready",
      busy: false,
      picture: { source: made, ...size },
      turns,
      natural: natural ?? (mod4(turns) % 2 ? { width: size.height, height: size.width } : size),
      note: reduced ? "Shown reduced to keep memory in check." : null,
    });
  }

  private fail(generation: number, message: string): void {
    if (generation === this.generation) this.set({ phase: "error", error: message, busy: false, picture: null });
  }

  /** Run one job per key at a time; callers asking for the same thing share it. */
  private once(key: string, job: () => Promise<string | null>): Promise<string | null> {
    const running = this.inflight.get(key);
    if (running) return running;
    const started = job().finally(() => this.inflight.delete(key));
    this.inflight.set(key, started);
    return started;
  }

  /** Turn the view a quarter turn (1 clockwise, -1 counterclockwise). */
  async rotate(direction: 1 | -1): Promise<void> {
    const { path, stamp, format, canTurn, kind } = this.snapshot;
    if (!path || !stamp || !format || !canTurn || kind !== "image") return;
    await this.prepareImage(path, stamp, format, mod4(this.snapshot.turns + direction), this.generation);
  }

  /** Write the turned picture beside the original as a new file; its name, or an error message. */
  async saveTurnedCopy(): Promise<{ saved: string } | { error: string }> {
    const { path, format, turns, canSave, stamp } = this.snapshot;
    if (!path || !format || !stamp || !canSave) return { error: "A turned copy cannot be saved for this file." };
    if (mod4(turns) === 0 && !this.snapshot.exifTurn) return { error: "Turn the picture first." };
    const dir = dirname(path);
    const name = copyName(basename(path), (candidate) => existsSync(join(dir, candidate)));
    const key = cacheKey(stamp, `save:${format}:${mod4(turns)}:${Date.now()}`);
    const partial = partialName(cacheFile(this.root, key, "bin"));
    const args = saveCopyArgs(format, turns, partial);
    if (!args) return { error: "A turned copy cannot be saved for this file." };
    const result = await runTool(args, { timeoutMs: CONVERT_TIMEOUT_MS, memoryMiB: CONVERT_MEMORY_MIB, input: Bun.file(path) });
    if (!result.ok || !existsSync(partial)) return { error: "The copy could not be made." };
    try {
      // A hard link fails when the name appeared meanwhile: a copy never replaces a file.
      linkSync(partial, join(dir, name));
    } catch {
      return { error: "The copy could not be written next to the original (is the folder writable?)." };
    } finally {
      try {
        unlinkSync(partial);
      } catch {
        // Already gone.
      }
    }
    return { saved: name };
  }

  /** Close what is open (the file went to the Trash). */
  clear(): void {
    this.generation++;
    this.thumbQueue = [];
    this.thumbs.clear();
    this.set({ phase: "empty", error: null, path: null, name: "", kind: null, format: null, picture: null, natural: null, turns: 0, canTurn: false, canSave: false, exifTurn: false, folder: EMPTY_FOLDER, pdf: null, busy: false, note: null, stamp: null });
  }

  /** Step through the folder's images; false at an end. */
  async step(delta: 1 | -1): Promise<boolean> {
    const { folder } = this.snapshot;
    const name = delta > 0 ? folder.next : folder.previous;
    if (!name) return false;
    await this.open(siblingPath(folder.dir, name));
    return true;
  }

  // --- PDFs -----------------------------------------------------------------

  private async openPdf(path: string, generation: number): Promise<void> {
    if (!this.snapshot.tools.poppler) return this.fail(generation, "PDF files need poppler-utils (pdftoppm and pdfinfo), which is not installed.");
    const info = await runTool(pdfinfoArgs(path), { timeoutMs: INFO_TIMEOUT_MS, memoryMiB: 1024, maxOutput: 256 * 1024 });
    if (generation !== this.generation) return;
    const parsed = info.ok ? parsePdfInfo(info.stdout) : null;
    if (!parsed) return this.fail(generation, wantsPassword(info.stderr) ? "This PDF is locked with a password, which Preview cannot enter yet." : "This PDF could not be read (it may be damaged).");
    if (parsed.encrypted && !parsed.pageSize) return this.fail(generation, "This PDF is locked with a password, which Preview cannot enter yet.");
    this.pagePoints = parsed.pageSize;
    this.set({ pdf: { pages: parsed.pages, page: 1, title: parsed.title, thumbs: new Map() } });
    this.set({ canTurn: false, canSave: false });
    await this.showPage(1, generation);
    this.queueThumbs(1);
  }

  /** Go to page `n` (1-based, held inside the document). */
  async goToPage(n: number): Promise<void> {
    const pdf = this.snapshot.pdf;
    if (!pdf) return;
    const page = Math.min(pdf.pages, Math.max(1, Math.trunc(n)));
    if (page === pdf.page && this.snapshot.picture) return;
    this.set({ pdf: { ...pdf, page } });
    this.queueThumbs(page);
    await this.showPage(page, this.generation);
  }

  /** The zoom changed: render the page again if the picture would be soft. `scale` is logical pixels per point. */
  async wantScale(scale: number): Promise<void> {
    const pdf = this.snapshot.pdf;
    const points = this.pagePoints;
    if (!pdf || !points) return;
    const dpi = chooseDpi(scale, this.deviceScale, points);
    if (dpi === this.wantedDpi) return;
    this.wantedDpi = dpi;
    if (this.currentDpi() === this.lastShownDpi) return;
    await this.showPage(pdf.page, this.generation);
  }

  /** The first guess at the zoom before any page is drawn: the page 1 size from pdfinfo. */
  get firstPageSize(): { width: number; height: number } | null {
    return this.pagePoints;
  }

  private async showPage(page: number, generation: number): Promise<void> {
    const { path, stamp } = this.snapshot;
    if (!path || !stamp) return;
    this.set({ busy: true });
    const dpi = this.currentDpi();
    const out = await this.renderPage(path, stamp, page, dpi);
    if (generation !== this.generation || this.snapshot.pdf?.page !== page || this.currentDpi() !== dpi) return;
    if (!out) return this.fail(generation, "This page could not be drawn (the PDF may be damaged).");
    const size = pngSize(out);
    if (!size) return this.fail(generation, "This page could not be read after drawing.");
    const points = { width: (size.width * 72) / dpi, height: (size.height * 72) / dpi };
    this.pagePoints = points;
    this.lastShownDpi = dpi;
    this.set({ phase: "ready", busy: false, picture: { source: out, ...points }, error: null });
    // The next page is likely wanted; have it by the time it is.
    const pages = this.snapshot.pdf?.pages ?? 0;
    if (page < pages) void this.renderPage(path, stamp, page + 1, dpi);
  }

  /** The wanted resolution held under the pixel cap for the page size known so far. */
  private currentDpi(): number {
    return chooseDpi(this.wantedDpi / (72 * this.deviceScale), this.deviceScale, this.pagePoints ?? { width: 612, height: 792 });
  }

  private renderPage(path: string, stamp: Stamp, page: number, effective: number): Promise<string | null> {
    const key = cacheKey(stamp, `pdf:${page}:${effective}`);
    const out = cacheFile(this.root, key, "png");
    return this.once(key, async () => {
      if (existsSync(out)) return out;
      const partialBase = partialName(join(this.root, key));
      const result = await runTool(pdftoppmArgs(path, page, effective, partialBase), { timeoutMs: RENDER_TIMEOUT_MS, memoryMiB: 2048 });
      const produced = `${partialBase}.png`;
      if (!result.ok || !existsSync(produced)) return null;
      publish(produced, out);
      return out;
    });
  }

  // --- Thumbnails -----------------------------------------------------------

  private queueThumbs(near: number): void {
    const pdf = this.snapshot.pdf;
    if (!pdf) return;
    const total = Math.min(pdf.pages, THUMB_LIMIT);
    this.thumbQueue = Array.from({ length: total }, (_, i) => i + 1)
      .filter((page) => !this.thumbs.has(page))
      .sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
    while (this.thumbWorkers < THUMB_WORKERS && this.thumbQueue.length > 0) {
      this.thumbWorkers++;
      void this.thumbLoop(this.generation).finally(() => {
        this.thumbWorkers--;
      });
    }
  }

  private async thumbLoop(generation: number): Promise<void> {
    while (generation === this.generation) {
      const page = this.thumbQueue.shift();
      const { path, stamp } = this.snapshot;
      if (page === undefined || !path || !stamp) return;
      if (this.thumbs.has(page)) continue;
      const key = cacheKey(stamp, `thumb:${page}`);
      const out = cacheFile(this.root, key, "png");
      const made = await this.once(key, async () => {
        if (existsSync(out)) return out;
        const partialBase = partialName(join(this.root, key));
        const result = await runTool(thumbnailArgs(path, page, partialBase), { timeoutMs: RENDER_TIMEOUT_MS, memoryMiB: 1024 });
        const produced = `${partialBase}.png`;
        if (!result.ok || !existsSync(produced)) return null;
        publish(produced, out);
        return out;
      });
      if (generation !== this.generation) return;
      const pdf = this.snapshot.pdf;
      if (made && pdf) {
        this.thumbs.set(page, made);
        this.set({ pdf: { ...pdf, thumbs: new Map(this.thumbs) } });
      }
    }
  }
}

/** A PNG's pixel size from its header, or null. */
export function pngSize(path: string): Size | null {
  try {
    const bytes = new Uint8Array(readFileSyncPrefix(path, 32));
    return readSize("png", bytes);
  } catch {
    return null;
  }
}

function readFileSyncPrefix(path: string, length: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

export { MAX_PAGES };
