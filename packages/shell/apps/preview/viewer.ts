/**
 * The viewer's state and everything slow it does: reading a file's header,
 * preparing a picture Metal can draw (converting or rotating it with
 * ImageMagick when it must), reading a PDF's pages (pdf-doc.ts makes them as
 * they come near the screen), and the open picture's folder (folder.ts). The
 * window (view.tsx) only subscribes to `getSnapshot()` and calls these
 * methods.
 *
 * Every open is a new generation: work that finishes for an older one is
 * dropped, so a quick run of arrow presses never paints a stale picture. A
 * rotation is remembered for the file (memory.ts), so it is there the next
 * time the file is open.
 */

import { stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { cacheFile, cacheKey, cacheRoot, ensureCache, partialName, publish, type Stamp } from "./cache.ts";
import { CONVERT_MEMORY_MIB, CONVERT_TIMEOUT_MS, convertible, MAX_NATIVE_PIXELS, magickArgs, REDUCED_PIXELS } from "./convert.ts";
import { HEADER_BYTES, jpegOrientation, readSize, type Size, swapsSides } from "./dimensions.ts";
import { Folder } from "./folder.ts";
import { factsFrom } from "./info.ts";
import { FORMATS, type Format, formatFromName, otherMime, sniff } from "./kinds.ts";
import { MemoryStore } from "./memory.ts";
import { MESSAGES } from "./messages.ts";
import { parsePdfInfo, pdfinfoArgs, plainTextArgs, wantsPassword } from "./pdf.ts";
import { PdfPages } from "./pdf-doc.ts";
import { neighbours, siblingPath } from "./siblings.ts";
import { CLOSED, EMPTY_FOLDER, type Snapshot } from "./snapshot.ts";
import type { PageText } from "./text.ts";
import { haveTool, runTool } from "./tools.ts";
import { mod4, turned } from "./zoom.ts";

/** Files over this are not opened at all. */
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const INFO_TIMEOUT_MS = 30_000;

export interface ViewerOptions {
  cacheDir?: string;
  deviceScale?: number;
  /** Where recent files and rotations are kept; null keeps them for this window only. */
  memoryFile?: string | null;
}

export class Viewer {
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private readonly root: string;
  private orientation = 1;
  private storedSize: Size | null = null;
  private readonly inflight = new Map<string, Promise<string | null>>();
  private readonly deviceScale: number;
  private readonly memory: MemoryStore;
  private pages: PdfPages | null = null;
  private pdfBase: { pages: number; title: string | null; sizes: Size[] } | null = null;
  private readonly folder: Folder;

  constructor(options: ViewerOptions = {}) {
    this.root = options.cacheDir ?? cacheRoot();
    this.deviceScale = options.deviceScale ?? 2;
    this.memory = options.memoryFile === undefined ? new MemoryStore() : new MemoryStore(options.memoryFile);
    try {
      ensureCache(this.root);
    } catch {
      // Without a cache nothing needing a conversion or a render works; the open says so.
    }
    const tools = { magick: haveTool("magick"), poppler: haveTool("pdftoppm") && haveTool("pdfinfo"), qpdf: haveTool("qpdf") };
    this.folder = new Folder({
      root: this.root,
      magick: tools.magick,
      onChange: () => this.folderChanged(),
      turnsFor: (path, file) => this.memory.turnsFor(path, file),
    });
    this.snapshot = { ...CLOSED, recents: this.memory.recents(), tools, rev: 0 };
    // Every window is its own process: what another opens is a recent file here too.
    this.memory.watch(() => this.set({ recents: this.memory.recents() }));
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

  private fail(generation: number, message: string): void {
    if (generation === this.generation) this.set({ phase: "error", error: message, busy: false, picture: null, pdf: null });
  }

  /** Open a file. A path that is not absolute is made so against the working folder. Stepping through a folder (`recent: false`) leaves the recent files as they are. */
  async open(input: string, { recent = true }: { recent?: boolean } = {}): Promise<void> {
    const path = resolve(input);
    const generation = ++this.generation;
    this.closePdf();
    // Stepping through a folder keeps its strip, and knows the new neighbours at once (a quick ← ← steps twice).
    const sameFolder = this.folder.dir !== "" && this.folder.dir === dirname(path);
    const folder = sameFolder ? { dir: this.folder.dir, files: this.folder.files, ...neighbours(this.folder.files, basename(path)) } : EMPTY_FOLDER;
    this.set({
      ...CLOSED,
      phase: "loading",
      path,
      name: basename(path),
      busy: true,
      folder,
      folderThumbs: sameFolder ? this.folder.thumbnails : new Map(),
      folderShapes: sameFolder ? this.folder.shapes : new Map(),
    });
    let stamp: Stamp;
    try {
      const info = await stat(path);
      if (generation !== this.generation) return;
      if (!info.isFile()) return this.fail(generation, MESSAGES.notAFile);
      if (info.size > MAX_FILE_BYTES) return this.fail(generation, MESSAGES.tooLarge);
      stamp = { path, mtimeMs: info.mtimeMs, size: info.size };
    } catch {
      return this.fail(generation, MESSAGES.notFound);
    }
    let head: Uint8Array;
    try {
      head = new Uint8Array(await Bun.file(path).slice(0, HEADER_BYTES).arrayBuffer());
    } catch {
      return this.fail(generation, MESSAGES.unreadable);
    }
    if (generation !== this.generation) return;
    const format = sniff(head);
    if (!format) {
      this.set({ mime: otherMime(head, path) });
      return this.fail(generation, formatFromName(path) ? MESSAGES.mislabelled : MESSAGES.unknownKind);
    }
    const kind = FORMATS[format].kind;
    if (recent) this.memory.opened(path);
    const turns = this.memory.turnsFor(path, stamp);
    this.set({ kind, format, mime: FORMATS[format].mime, stamp, turns, facts: factsFrom(path, stamp, format), recents: this.memory.recents() });
    if (kind === "pdf") {
      this.folder.hide();
      this.set({ folder: EMPTY_FOLDER, folderThumbs: new Map(), folderShapes: new Map() });
      await this.openPdf(path, stamp, turns, generation);
    } else {
      void this.showFolder(path);
      await this.openImage(path, stamp, format, head, turns, generation);
    }
  }

  /** Close what is open (the file went to the Trash). */
  clear(): void {
    this.generation++;
    this.closePdf();
    this.folder.hide();
    this.set({ ...CLOSED, recents: this.memory.recents() });
  }

  /** Step through the folder's images; false at an end. */
  async step(delta: 1 | -1): Promise<boolean> {
    const { folder } = this.snapshot;
    const name = delta > 0 ? folder.next : folder.previous;
    if (!name) return false;
    await this.open(siblingPath(folder.dir, name), { recent: false });
    return true;
  }

  /** Open the folder's picture called `name`. */
  async openSibling(name: string): Promise<void> {
    const { folder } = this.snapshot;
    if (folder.files.includes(name)) await this.open(siblingPath(folder.dir, name), { recent: false });
  }

  /** Rotate a quarter turn (1 clockwise, -1 counterclockwise); the file keeps it. */
  async rotate(direction: 1 | -1): Promise<void> {
    const { path, stamp, format, canTurn, kind } = this.snapshot;
    if (!path || !stamp || !format || !canTurn) return;
    const turns = mod4(this.snapshot.turns + direction);
    this.memory.rotated(path, turns, stamp);
    if (kind === "pdf" && this.pages && this.pdfBase) {
      this.pages.setTurns(turns);
      this.set({ turns });
      this.pdfChanged();
      return;
    }
    this.folder.turned(basename(path));
    await this.prepareImage(path, stamp, format, turns, this.generation);
  }

  forgetRecents(): void {
    this.memory.clearRecents();
    this.set({ recents: [] });
  }

  // --- The folder -------------------------------------------------------------

  private async showFolder(path: string): Promise<void> {
    await this.folder.show(dirname(path));
    this.folderChanged();
  }

  private folderChanged(): void {
    const { path, kind } = this.snapshot;
    if (!path || kind === "pdf") return;
    const files = this.folder.files;
    this.set({
      folder: { dir: this.folder.dir, files, ...neighbours(files, basename(path)) },
      folderThumbs: this.folder.thumbnails,
      folderShapes: this.folder.shapes,
    });
  }

  /** The strip's rows that need a small copy, the most wanted first. */
  wantFolderThumbs(names: readonly string[]): void {
    this.folder.want(names);
  }

  // --- Images ---------------------------------------------------------------

  private async openImage(path: string, stamp: Stamp, format: Format, head: Uint8Array, turns: number, generation: number): Promise<void> {
    this.orientation = format === "jpeg" ? jpegOrientation(head) : 1;
    const stored = readSize(format, head);
    this.storedSize = stored;
    const natural = stored ? (swapsSides(this.orientation) ? { width: stored.height, height: stored.width } : stored) : null;
    const canTurn = this.snapshot.tools.magick && convertible(format);
    this.set({ natural, canTurn });
    await this.prepareImage(path, stamp, format, canTurn ? turns : 0, generation);
  }

  private async prepareImage(path: string, stamp: Stamp, format: Format, turns: number, generation: number): Promise<void> {
    const natural = this.snapshot.natural;
    const pixels = natural ? natural.width * natural.height : 0;
    // A GIF is shown as its first frame (Metal would play it, holding every frame in memory).
    const needsWork = !FORMATS[format].native || this.orientation !== 1 || turns !== 0 || pixels > MAX_NATIVE_PIXELS || format === "gif";
    const { magick } = this.snapshot.tools;
    if (!needsWork || !convertible(format) || !magick) {
      if (!FORMATS[format].native) return this.fail(generation, MESSAGES.cantOpenKind(FORMATS[format].label));
      if (pixels > MAX_NATIVE_PIXELS) return this.fail(generation, MESSAGES.tooLargeToShow);
      const size = natural ?? this.storedSize;
      if (!size) return this.fail(generation, MESSAGES.noSize);
      const note = this.orientation !== 1 && format !== "svg" ? MESSAGES.notUpright : null;
      if (generation === this.generation) this.set({ phase: "ready", busy: false, picture: { source: path, ...size }, turns, note });
      return;
    }
    this.set({ busy: true });
    const key = cacheKey(stamp, `img:${format}:${mod4(turns)}:${REDUCED_PIXELS}`);
    const out = cacheFile(this.root, key, "png");
    const made = await this.once(key, async () => {
      if (await Bun.file(out).exists()) return out;
      const partial = partialName(out);
      const args = magickArgs({ format, turns, maxPixels: REDUCED_PIXELS, output: partial });
      if (!args) return null;
      const result = await runTool(args, { timeoutMs: CONVERT_TIMEOUT_MS, memoryMiB: CONVERT_MEMORY_MIB, input: Bun.file(path) });
      if (!result.ok || !(await Bun.file(partial).exists())) return null;
      publish(partial, out);
      return out;
    });
    if (generation !== this.generation) return;
    if (!made) return this.fail(generation, MESSAGES.damaged);
    const size = await pngSize(made);
    if (generation !== this.generation) return;
    if (!size) return this.fail(generation, MESSAGES.damaged);
    const upright = natural ? turned(natural, turns) : null;
    const reduced = upright !== null && (size.width < upright.width || size.height < upright.height);
    this.set({
      phase: "ready",
      busy: false,
      picture: { source: made, ...size },
      turns,
      natural: natural ?? turned(size, turns),
      note: reduced ? MESSAGES.shownSmaller : null,
    });
  }

  /** Run one job per key at a time; callers asking for the same thing share it. */
  private once(key: string, job: () => Promise<string | null>): Promise<string | null> {
    const running = this.inflight.get(key);
    if (running) return running;
    const started = job().finally(() => this.inflight.delete(key));
    this.inflight.set(key, started);
    return started;
  }

  // --- PDFs -----------------------------------------------------------------

  private closePdf(): void {
    this.pages?.close();
    this.pages = null;
    this.pdfBase = null;
  }

  private async openPdf(path: string, stamp: Stamp, turns: number, generation: number): Promise<void> {
    if (!this.snapshot.tools.poppler) return this.fail(generation, MESSAGES.cantOpenPdf);
    const info = await runTool(pdfinfoArgs(path), { timeoutMs: INFO_TIMEOUT_MS, memoryMiB: 1024, maxOutput: 2 * 1024 * 1024 });
    if (generation !== this.generation) return;
    const parsed = info.ok ? parsePdfInfo(info.stdout) : null;
    if (!parsed) return this.fail(generation, wantsPassword(info.stderr) ? MESSAGES.locked : MESSAGES.damagedPdf);
    if (parsed.encrypted && !parsed.pageSize) return this.fail(generation, MESSAGES.locked);
    const canTurn = this.snapshot.tools.magick;
    const shownTurns = canTurn ? turns : 0;
    this.pdfBase = { pages: parsed.pages, title: parsed.title, sizes: parsed.pageSizes };
    this.pages = new PdfPages({
      path,
      stamp,
      root: this.root,
      sizes: parsed.pageSizes,
      deviceScale: this.deviceScale,
      turns: shownTurns,
      onChange: () => {
        if (generation === this.generation) this.pdfChanged();
      },
    });
    this.set({ phase: "ready", busy: false, canTurn, turns: shownTurns });
    this.pdfChanged();
  }

  private pdfChanged(): void {
    const base = this.pdfBase;
    if (!base || !this.pages) return;
    const turns = this.snapshot.turns;
    this.set({ pdf: { ...base, sizes: base.sizes.map((size) => turned(size, turns)), ...this.pages.state } });
  }

  /** What the document surface needs now: pages near the screen at `scale` (logical pixels per point), the strip's thumbnails. */
  wantPages(pages: readonly number[], scale: number, thumbs: readonly number[]): void {
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

  /** Pages `from` to `to` as plain text (a copy across many pages); empty when they can't be read. */
  async plainText(from: number, to: number): Promise<string> {
    const { path, kind } = this.snapshot;
    if (!path || kind !== "pdf" || to < from) return "";
    const result = await runTool(plainTextArgs(path, from, to), { timeoutMs: INFO_TIMEOUT_MS * 4, memoryMiB: 1024, maxOutput: 64 * 1024 * 1024 });
    // pdftotext ends each page with a form feed.
    return result.ok ? result.stdout.replaceAll("\f", "\n\n") : "";
  }

  /** The resolution a page is rendered at for `scale`, so the window can ask for the same one (Copy, Export). */
  dpiFor(page: number, scale: number): number {
    return this.pages?.dpiFor(page, scale) ?? 144;
  }
}

/** A PNG's pixel size from its header, or null. */
export async function pngSize(path: string): Promise<Size | null> {
  try {
    const bytes = new Uint8Array(await Bun.file(path).slice(0, 32).arrayBuffer());
    return readSize("png", bytes);
  } catch {
    return null;
  }
}
