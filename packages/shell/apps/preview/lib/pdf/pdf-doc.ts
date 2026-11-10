/**
 * An open PDF's pages, made as they are wanted: a page is rendered when it
 * comes near the screen (at the resolution the zoom asks for), its thumbnail
 * when it comes into the page strip, its words when a drag starts on it.
 * The surface says what it wants (`want`), nearest first; two helper
 * processes work through that, and each result is cached (cache.ts) and
 * announced (`onChange`). A rotation is applied to the rendered pictures
 * (ImageMagick), so pages and thumbnails turn together; words are kept as
 * poppler gives them and turned where they are drawn (text.ts).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { cacheFile, cacheKey, partialName, publish, type Stamp } from "../cache.ts";
import { CONVERT_MEMORY_MIB, CONVERT_TIMEOUT_MS, turnPngArgs } from "../convert.ts";
import type { Size } from "../dimensions.ts";
import { type PageText, parseBboxLayout } from "../text.ts";
import { type RunOptions, type RunResult, runTool } from "../tools.ts";
import { mod4 } from "../zoom.ts";
import { chooseDpi, pdftoppmArgs, pdftotextArgs, thumbnailArgs } from "./pdf.ts";

const RENDER_TIMEOUT_MS = 45_000;
const WORKERS = 2;

export interface PageRender {
  /** The PNG, rotated as the document is. */
  source: string;
  dpi: number;
}

/** What the window draws from. */
export interface PdfPagesState {
  renders: ReadonlyMap<number, PageRender>;
  thumbs: ReadonlyMap<number, string>;
  texts: ReadonlyMap<number, PageText>;
  /** Pages near the screen are still being drawn. */
  working: boolean;
}

type Job = { kind: "render"; page: number; dpi: number } | { kind: "thumb"; page: number } | { kind: "text"; page: number };

const jobKey = (job: Job): string => (job.kind === "render" ? `render:${job.page}:${job.dpi}` : `${job.kind}:${job.page}`);

export interface PdfPagesOptions {
  path: string;
  stamp: Stamp;
  /** The cache folder. */
  root: string;
  /** Each page's size in points, as shown before Preview's rotation. */
  sizes: readonly Size[];
  deviceScale: number;
  /** Quarter turns clockwise. */
  turns: number;
  onChange: () => void;
  run?: (argv: readonly string[], options: RunOptions) => Promise<RunResult>;
}

export class PdfPages {
  private readonly renders = new Map<number, PageRender>();
  private readonly thumbs = new Map<number, string>();
  private readonly texts = new Map<number, PageText>();
  private queue: Job[] = [];
  private readonly active = new Set<string>();
  private readonly failed = new Set<string>();
  private workers = 0;
  private generation = 0;
  private turns: number;
  private readonly run: NonNullable<PdfPagesOptions["run"]>;
  /** The renders the screen wants now; `working` is true while one of them is missing. */
  private wantedRenders: Array<{ page: number; dpi: number }> = [];

  constructor(private readonly options: PdfPagesOptions) {
    this.turns = mod4(options.turns);
    this.run = options.run ?? runTool;
  }

  get state(): PdfPagesState {
    return { renders: new Map(this.renders), thumbs: new Map(this.thumbs), texts: new Map(this.texts), working: this.isWorking() };
  }

  private isWorking(): boolean {
    return this.wantedRenders.some(({ page, dpi }) => this.renders.get(page)?.dpi !== dpi && !this.failed.has(jobKey({ kind: "render", page, dpi })));
  }

  /** The resolution a page wants at `scale` (logical pixels per point). */
  dpiFor(page: number, scale: number): number {
    return chooseDpi(scale, this.options.deviceScale, this.options.sizes[page - 1] ?? { width: 612, height: 792 });
  }

  /**
   * What the screen wants now, the most wanted first: renders of the pages
   * near the screen at `scale`, thumbnails of the strip's rows. What was
   * wanted before and hasn't started is dropped.
   */
  want(pages: readonly number[], scale: number, thumbs: readonly number[]): void {
    const wasWorking = this.isWorking();
    this.wantedRenders = pages.map((page) => ({ page, dpi: this.dpiFor(page, scale) }));
    const renders: Job[] = this.wantedRenders
      .filter(({ page, dpi }) => this.renders.get(page)?.dpi !== dpi)
      .map(({ page, dpi }) => ({ kind: "render", page, dpi }));
    const thumbJobs: Job[] = thumbs.filter((page) => !this.thumbs.has(page)).map((page) => ({ kind: "thumb", page }));
    const texts = this.queue.filter((job) => job.kind === "text");
    this.queue = [...texts, ...renders, ...thumbJobs].filter((job) => !this.active.has(jobKey(job)) && !this.failed.has(jobKey(job)));
    this.pump();
    if (this.isWorking() !== wasWorking) this.options.onChange();
  }

  /** A page's words, read when first asked for. */
  wantText(page: number): void {
    const job: Job = { kind: "text", page };
    if (this.texts.has(page) || this.active.has(jobKey(job)) || this.failed.has(jobKey(job))) return;
    this.queue = [job, ...this.queue.filter((each) => jobKey(each) !== jobKey(job))];
    this.pump();
  }

  /** The words of `pages` (a copy across pages, Select All): those not read yet are read now. */
  async textOf(pages: readonly number[]): Promise<ReadonlyMap<number, PageText>> {
    const generation = this.generation;
    for (const page of pages) {
      if (this.texts.has(page)) continue;
      const text = await this.readText(page);
      if (generation !== this.generation) break;
      if (text) this.texts.set(page, text);
    }
    return new Map(this.texts);
  }

  /** The document turned: renders and thumbnails are made again (from the cache when they were before); words stay. */
  setTurns(turns: number): void {
    this.turns = mod4(turns);
    this.generation++;
    this.renders.clear();
    this.thumbs.clear();
    this.queue = this.queue.filter((job) => job.kind === "text");
    this.active.clear();
    this.failed.clear();
    this.options.onChange();
  }

  /** Stop: nothing more is started or announced. */
  close(): void {
    this.generation++;
    this.queue = [];
  }

  private pump(): void {
    while (this.workers < WORKERS && this.queue.length > 0) {
      this.workers++;
      void this.work(this.generation).finally(() => {
        this.workers--;
        // A worker of an older generation stopped while there is work: start one for this one.
        if (this.queue.length > 0) this.pump();
      });
    }
  }

  private async work(generation: number): Promise<void> {
    while (generation === this.generation) {
      const job = this.queue.shift();
      if (!job) return;
      const key = jobKey(job);
      if (this.active.has(key)) continue;
      this.active.add(key);
      const done = await this.perform(job);
      if (generation !== this.generation) return;
      this.active.delete(key);
      if (!done) this.failed.add(key);
      this.options.onChange();
    }
  }

  private async perform(job: Job): Promise<boolean> {
    if (job.kind === "text") {
      const text = await this.readText(job.page);
      if (text) this.texts.set(job.page, text);
      return text !== null;
    }
    const turns = this.turns;
    const made = job.kind === "render" ? await this.renderPage(job.page, job.dpi, turns) : await this.thumbnail(job.page, turns);
    if (!made) return false;
    if (turns !== this.turns) return true;
    if (job.kind === "render") this.renders.set(job.page, { source: made, dpi: job.dpi });
    else this.thumbs.set(job.page, made);
    return true;
  }

  private async readText(page: number): Promise<PageText | null> {
    const result = await this.run(pdftotextArgs(this.options.path, page), { timeoutMs: RENDER_TIMEOUT_MS, memoryMiB: 1024, maxOutput: 8 * 1024 * 1024 });
    return result.ok ? parseBboxLayout(result.stdout) : null;
  }

  /** A poppler run that makes `<base>.png`, published as the cache's PNG for `key` (or already there). */
  private async make(key: string, argv: (base: string) => string[], memoryMiB: number): Promise<string | null> {
    const out = cacheFile(this.options.root, key, "png");
    if (existsSync(out)) return out;
    const base = partialName(join(this.options.root, key));
    const result = await this.run(argv(base), { timeoutMs: RENDER_TIMEOUT_MS, memoryMiB });
    const produced = `${base}.png`;
    if (!result.ok || !existsSync(produced)) return null;
    publish(produced, out);
    return out;
  }

  /** `plain` turned `turns` quarter turns, cached beside it. */
  private async turned(plain: string | null, request: string, turns: number): Promise<string | null> {
    if (!plain || turns === 0) return plain;
    const out = cacheFile(this.options.root, cacheKey(this.options.stamp, `${request}:t${turns}`), "png");
    if (existsSync(out)) return out;
    const partial = partialName(out);
    const result = await this.run(turnPngArgs(plain, turns, partial), { timeoutMs: CONVERT_TIMEOUT_MS, memoryMiB: CONVERT_MEMORY_MIB });
    if (!result.ok || !existsSync(partial)) return null;
    publish(partial, out);
    return out;
  }

  private async renderPage(page: number, dpi: number, turns: number): Promise<string | null> {
    const request = `pdf:${page}:${dpi}`;
    const plain = await this.make(cacheKey(this.options.stamp, request), (base) => pdftoppmArgs(this.options.path, page, dpi, base), 2048);
    return this.turned(plain, request, turns);
  }

  private async thumbnail(page: number, turns: number): Promise<string | null> {
    const request = `thumb:${page}`;
    const plain = await this.make(cacheKey(this.options.stamp, request), (base) => thumbnailArgs(this.options.path, page, base), 1024);
    return this.turned(plain, request, turns);
  }
}
