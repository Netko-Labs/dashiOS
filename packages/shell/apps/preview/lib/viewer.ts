/**
 * The viewer's state and everything slow it does: reading a file's head (file-head.ts),
 * preparing a picture Metal can draw (converting or rotating it with
 * ImageMagick when it must, image-job.ts), opening a PDF and reading its
 * pages (pdf-session.ts, which pdf-doc.ts renders as they come near the
 * screen), and the open picture's folder (folder.ts). The window (view.tsx)
 * only subscribes to `getSnapshot()` and calls these methods.
 *
 * Every open is a new generation: work that finishes for an older one is
 * dropped, so a quick run of arrow presses never paints a stale picture. A
 * rotation is remembered for the file (memory.ts), so it is there the next
 * time the file is open.
 */

import { basename, dirname, resolve } from "node:path";
import { FORMATS, type Format, formatFromName, otherMime, sniff } from "../../../src/shared/files/kinds.ts";
import { cacheRoot, ensureCache, type Stamp } from "./cache.ts";
import { convertible, MAX_NATIVE_PIXELS } from "./convert.ts";
import { jpegOrientation, readSize, type Size, swapsSides } from "./dimensions.ts";
import { readFileHead } from "./file-head.ts";
import { Folder } from "./folder.ts";
import { pngSize, reducedPng } from "./image-job.ts";
import { factsFrom } from "./info.ts";
import { MemoryStore } from "./memory.ts";
import { MESSAGES } from "./messages.ts";
import { PdfSession, plainTextOf, probePdf } from "./pdf/pdf-session.ts";
import { neighbours, siblingPath } from "./siblings.ts";
import { CLOSED, EMPTY_FOLDER, type Snapshot } from "./snapshot.ts";
import type { PageText } from "./text.ts";
import { haveTool } from "./tools.ts";
import { mod4, turned } from "./zoom.ts";

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
  private readonly pdf = new PdfSession();
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
    this.pdf.close();
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
    const read = await readFileHead(path);
    if (generation !== this.generation) return;
    if (!read.ok) return this.fail(generation, read.message);
    const { stamp, head } = read;
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
    this.pdf.close();
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
    if (kind === "pdf" && this.pdf.setTurns(turns)) {
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
    const made = await reducedPng({ root: this.root, path, stamp, format, turns, inflight: this.inflight });
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

  // --- PDFs -----------------------------------------------------------------

  private async openPdf(path: string, stamp: Stamp, turns: number, generation: number): Promise<void> {
    if (!this.snapshot.tools.poppler) return this.fail(generation, MESSAGES.cantOpenPdf);
    const probed = await probePdf(path);
    if (generation !== this.generation) return;
    if (!probed.ok) return this.fail(generation, probed.message);
    const canTurn = this.snapshot.tools.magick;
    const shownTurns = canTurn ? turns : 0;
    this.pdf.start(probed.probe, {
      path,
      stamp,
      root: this.root,
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
    const state = this.pdf.state(this.snapshot.turns);
    if (state) this.set({ pdf: state });
  }

  /** What the document surface needs now: pages near the screen at `scale` (logical pixels per point), the strip's thumbnails. */
  wantPages(pages: readonly number[], scale: number, thumbs: readonly number[]): void {
    this.pdf.want(pages, scale, thumbs);
  }

  /** A page's words, for a drag that selects text on it. */
  wantText(page: number): void {
    this.pdf.wantText(page);
  }

  /** The words of `pages`, read now where they aren't yet. */
  async textOf(pages: readonly number[]): Promise<ReadonlyMap<number, PageText>> {
    return this.pdf.textOf(pages);
  }

  /** Pages `from` to `to` as plain text (a copy across many pages); empty when they can't be read. */
  async plainText(from: number, to: number): Promise<string> {
    const { path, kind } = this.snapshot;
    if (!path || kind !== "pdf" || to < from) return "";
    return plainTextOf(path, from, to);
  }

  /** The resolution a page is rendered at for `scale`, so the window can ask for the same one (Copy, Export). */
  dpiFor(page: number, scale: number): number {
    return this.pdf.dpiFor(page, scale);
  }
}
