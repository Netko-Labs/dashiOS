/**
 * The folder of an open picture, for stepping through it and for the page
 * strip's filmstrip: its pictures listed once, off the UI thread, and listed
 * again when the folder changes (a watch on it); and each picture's small
 * copy, made when its row comes into the strip (ImageMagick, cached) and
 * turned as Preview shows the picture (its kept rotation), or the picture
 * itself when it is small enough to draw as it is.
 */

import { existsSync, type FSWatcher, watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { cacheFile, cacheKey, partialName, publish } from "./cache.ts";
import { CONVERT_MEMORY_MIB, thumbnailArgs } from "./convert.ts";
import { FORMATS, formatFromName } from "./kinds.ts";
import { orderSiblings } from "./siblings.ts";
import { type RunOptions, type RunResult, runTool } from "./tools.ts";

/** A folder this large is listed up to here; the rest is not reachable with the arrow keys. */
const MAX_ENTRIES = 20_000;
/** A picture drawn as its own thumbnail when ImageMagick can't make one: at most this many bytes. */
const DRAWN_AS_IS_BYTES = 12 * 1024 * 1024;
const WORKERS = 2;
const THUMB_TIMEOUT_MS = 20_000;

/** The pictures in `dir`, in the order a person reads them; empty when it can't be read. */
export async function listPictures(dir: string): Promise<string[]> {
  try {
    return orderSiblings((await readdir(dir)).slice(0, MAX_ENTRIES), "image");
  } catch {
    return [];
  }
}

export interface FolderOptions {
  root: string;
  magick: boolean;
  onChange: () => void;
  run?: (argv: readonly string[], options: RunOptions) => Promise<RunResult>;
  /** The quarter turns Preview keeps for a picture (memory.ts); none when not given. */
  turnsFor?: (path: string, file: { size: number; mtimeMs: number }) => number;
  /** Watches a folder; returns the way to stop. */
  watchDir?: (dir: string, onChange: () => void) => () => void;
}

function watchFolder(dir: string, onChange: () => void): () => void {
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dir, { persistent: false }, () => onChange());
    watcher.on("error", () => watcher?.close());
  } catch {
    // Not watchable (a network mount): it is listed again when a file there is opened.
  }
  return () => watcher?.close();
}

export class Folder {
  dir = "";
  files: string[] = [];
  private readonly thumbs = new Map<string, string>();
  private readonly failed = new Set<string>();
  /** Thumbnails shown until their remade copy (turned since) replaces them. */
  private readonly stale = new Set<string>();
  private queue: string[] = [];
  private workers = 0;
  private stopWatching: () => void = () => {};
  private listing = 0;
  private readonly run: NonNullable<FolderOptions["run"]>;

  constructor(private readonly options: FolderOptions) {
    this.run = options.run ?? runTool;
  }

  /** The thumbnails made so far, by name. */
  get thumbnails(): ReadonlyMap<string, string> {
    return new Map(this.thumbs);
  }

  /** Show this folder: listed now if it is a new one (or `again`), watched while it is shown. */
  async show(dir: string, again = false): Promise<void> {
    if (dir === this.dir && !again) return;
    if (dir !== this.dir) {
      this.stopWatching();
      this.thumbs.clear();
      this.failed.clear();
      this.stale.clear();
      this.queue = [];
      this.dir = dir;
      this.files = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      // A burst of changes (a copy of many files) is listed once.
      this.stopWatching = (this.options.watchDir ?? watchFolder)(dir, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void this.show(dir, true), 300);
      });
    }
    const listing = ++this.listing;
    const files = await listPictures(dir);
    if (listing !== this.listing || dir !== this.dir) return;
    this.files = files;
    this.options.onChange();
  }

  /** No folder (a PDF is open, or nothing). */
  hide(): void {
    this.stopWatching();
    this.stopWatching = () => {};
    this.dir = "";
    this.files = [];
    this.queue = [];
    this.listing++;
  }

  private needs(name: string): boolean {
    return (!this.thumbs.has(name) || this.stale.has(name)) && !this.failed.has(name);
  }

  /** The strip's rows that need a thumbnail, the most wanted first. */
  want(names: readonly string[]): void {
    this.queue = names.filter((name) => this.needs(name));
    while (this.workers < WORKERS && this.queue.length > 0) {
      this.workers++;
      void this.work(this.dir).finally(() => {
        this.workers--;
      });
    }
  }

  private async work(dir: string): Promise<void> {
    while (dir === this.dir) {
      const name = this.queue.shift();
      if (name === undefined) return;
      if (!this.needs(name)) continue;
      const made = await this.thumbnail(join(dir, name));
      if (dir !== this.dir) return;
      this.stale.delete(name);
      if (made) this.thumbs.set(name, made);
      else if (!this.thumbs.has(name)) this.failed.add(name);
      this.options.onChange();
    }
  }

  /** A picture was turned: its thumbnail is made again (the old one shows meanwhile). */
  turned(name: string): void {
    if (!this.files.includes(name)) return;
    this.failed.delete(name);
    if (this.thumbs.has(name)) this.stale.add(name);
    this.want([name, ...this.queue]);
  }

  private async thumbnail(path: string): Promise<string | null> {
    const format = formatFromName(path);
    if (!format) return null;
    let info: { size: number; mtimeMs: number };
    try {
      info = await stat(path);
    } catch {
      return null;
    }
    const native = FORMATS[format].native && format !== "gif";
    if (!this.options.magick || !thumbnailArgs(format, "")) return native && info.size <= DRAWN_AS_IS_BYTES ? path : null;
    const turns = this.options.turnsFor?.(path, info) ?? 0;
    const out = cacheFile(this.options.root, cacheKey({ path, mtimeMs: info.mtimeMs, size: info.size }, `strip:${turns}`), "png");
    if (existsSync(out)) return out;
    const partial = partialName(out);
    const args = thumbnailArgs(format, partial, turns);
    if (!args) return null;
    const result = await this.run(args, { timeoutMs: THUMB_TIMEOUT_MS, memoryMiB: CONVERT_MEMORY_MIB, input: Bun.file(path) });
    if (!result.ok || !existsSync(partial)) return native && info.size <= DRAWN_AS_IS_BYTES ? path : null;
    publish(partial, out);
    return out;
  }
}
