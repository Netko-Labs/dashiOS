/**
 * Making thumbnails, as Nautilus did, so pictures, videos, songs' covers, and
 * office documents show themselves in the grid. The system's thumbnailers
 * are declared in `<data dir>/thumbnailers/*.thumbnailer` (glycin's for
 * pictures, GStreamer's for video and audio, libgsf's for office files); one
 * runs per file, two at a time, in a bubblewrap sandbox when there is one (a
 * read-only system, no network, a private folder to write to), and is
 * stopped after a while. Its PNG goes into the freedesktop cache
 * (`~/.cache/thumbnails/large/`) with the file's URI and modification time,
 * so an edited file is thumbnailed again (thumbs.ts reads them). A file that
 * fails is remembered for that modification time and not tried again.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileUri } from "../../files/index.ts";
import { parseThumbnailer, type ThumbnailerSpec, thumbnailerArgv } from "./thumbnailer-spec.ts";
import { thumbName } from "./thumbs.ts";

/** Which command makes each type's thumbnail: the first data dir's thumbnailer wins, and one whose TryExec isn't here doesn't count. */
export function loadThumbnailers(
  dataDirs: readonly string[],
  which: (program: string) => string | null = (program) => Bun.which(program),
): Map<string, string[]> {
  const byMime = new Map<string, string[]>();
  for (const dir of dataDirs) {
    const folder = join(dir, "thumbnailers");
    let names: string[];
    try {
      names = readdirSync(folder)
        .filter((name) => name.endsWith(".thumbnailer"))
        .sort();
    } catch {
      continue;
    }
    for (const name of names) {
      let spec: ThumbnailerSpec | null;
      try {
        spec = parseThumbnailer(readFileSync(join(folder, name), "utf8"));
      } catch {
        continue;
      }
      if (!spec || (spec.tryExec && !which(spec.tryExec))) continue;
      for (const mime of spec.mimeTypes) if (!byMime.has(mime)) byMime.set(mime, spec.exec);
    }
  }
  return byMime;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function textChunk(key: string, value: string): Uint8Array {
  const data = new TextEncoder().encode(`${key}\0${value}`);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode("tEXt"), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** `png` with `Thumb::URI` and `Thumb::MTime` text chunks right after its header, or null when it isn't a PNG. */
export function withThumbInfo(png: Uint8Array, uri: string, mtimeSeconds: number): Uint8Array | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 33 || signature.some((byte, index) => png[index] !== byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (String.fromCharCode(...png.subarray(12, 16)) !== "IHDR") return null;
  const afterHeader = 8 + 12 + view.getUint32(8);
  const chunks = [textChunk("Thumb::URI", uri), textChunk("Thumb::MTime", String(mtimeSeconds))];
  const out = new Uint8Array(png.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  out.set(png.subarray(0, afterHeader), 0);
  let at = afterHeader;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  out.set(png.subarray(afterHeader), at);
  return out;
}

/** The freedesktop "large" size, the one Files makes. */
export const LARGE = 256;
const TIMEOUT_MS = 15_000;
const AT_ONCE = 2;

/** Wraps a thumbnailer's command in bubblewrap: the system read-only, no network or other namespaces, `out` the one place to write. */
export function sandboxed(argv: readonly string[], out: string, bwrap: string | null): string[] {
  if (!bwrap) return [...argv];
  return [
    bwrap,
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--bind",
    out,
    out,
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--",
    ...argv,
  ];
}

export interface ThumbJob {
  path: string;
  mime: string;
  mtimeMs: number;
}

/** Makes thumbnails in the background; listeners hear each one that lands. */
export class ThumbnailMaker {
  private readonly queue: ThumbJob[] = [];
  private readonly pending = new Set<string>();
  private running = 0;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private thumbnailers: Map<string, string[]> | null = null;
  private readonly bwrap: string | null;

  constructor(
    private readonly cacheDir: string,
    private readonly dataDirs: () => readonly string[],
    private readonly which: (program: string) => string | null = (program) => Bun.which(program),
  ) {
    this.bwrap = which("bwrap");
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Goes up by one with each thumbnail made, for views to look again. */
  getVersion = (): number => this.version;

  /** Whether a thumbnailer here makes pictures of `mime`. */
  can(mime: string): boolean {
    this.thumbnailers ??= loadThumbnailers(this.dataDirs(), this.which);
    return this.thumbnailers.has(mime);
  }

  /** Make `job`'s thumbnail unless one is on its way or it failed before at this modification time. */
  request(job: ThumbJob): void {
    if (!this.can(job.mime)) return;
    const key = `${job.path}\0${Math.floor(job.mtimeMs / 1000)}`;
    if (this.pending.has(key) || this.failedBefore(job)) return;
    this.pending.add(key);
    this.queue.push(job);
    this.pump();
  }

  private failMarker(path: string): string {
    return join(this.cacheDir, "thumbnails", "fail", "dashi-files", thumbName(path));
  }

  private failedBefore(job: ThumbJob): boolean {
    try {
      return readFileSync(this.failMarker(job.path), "utf8") === String(Math.floor(job.mtimeMs / 1000));
    } catch {
      return false;
    }
  }

  private pump(): void {
    while (this.running < AT_ONCE && this.queue.length > 0) {
      const job = this.queue.shift() as ThumbJob;
      this.running++;
      void this.make(job).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async make(job: ThumbJob): Promise<void> {
    const exec = this.thumbnailers?.get(job.mime);
    if (!exec) return;
    const seconds = Math.floor(job.mtimeMs / 1000);
    const work = join(tmpdir(), `dashi-thumb-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(work, { recursive: true, mode: 0o700 });
    const output = join(work, "thumb.png");
    let made: Uint8Array | null = null;
    try {
      const child = Bun.spawn(sandboxed(thumbnailerArgv(exec, { input: job.path, output, size: LARGE }), work, this.bwrap), {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
      const code = await child.exited;
      clearTimeout(timer);
      if (code === 0 && existsSync(output)) made = withThumbInfo(new Uint8Array(readFileSync(output)), fileUri(job.path), seconds);
    } catch {
      made = null;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    try {
      if (made) {
        const dir = join(this.cacheDir, "thumbnails", "large");
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = join(dir, thumbName(job.path));
        const partial = `${file}.${process.pid}.part`;
        writeFileSync(partial, made, { mode: 0o600 });
        renameSync(partial, file);
        this.version++;
        for (const listener of this.listeners) listener();
      } else {
        const marker = this.failMarker(job.path);
        mkdirSync(join(marker, ".."), { recursive: true, mode: 0o700 });
        writeFileSync(marker, String(seconds), { mode: 0o600 });
      }
    } catch {
      // A cache that can't be written: no thumbnail, nothing else lost.
    }
  }
}

const makers = new Map<string, ThumbnailMaker>();

/** The one maker for a cache folder, using the system's data dirs. */
export function thumbnailMaker(cacheDir: string, dataDirs: () => readonly string[]): ThumbnailMaker {
  let maker = makers.get(cacheDir);
  if (!maker) {
    maker = new ThumbnailMaker(cacheDir, dataDirs);
    makers.set(cacheDir, maker);
  }
  return maker;
}
