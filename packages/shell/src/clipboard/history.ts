/**
 * Clipboard history: what was copied, newest first, kept on this computer
 * only, in `$XDG_STATE_HOME/dashi/clipboard/` (the folder 0700, every file
 * 0600): `history.json`, and the pictures beside it in `images/`. At most
 * 200 copies, none older than 7 days; pinned copies stay until unpinned.
 * A copy that is already there moves to the top instead of being kept
 * twice. What was not kept is counted, so the launcher can say so ("2
 * copies not kept"), but never what it was.
 */

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { extensionFor, type Size } from "./lib/images.ts";
import type { SkipReason } from "./lib/privacy.ts";

export const MAX_ENTRIES = 200;
export const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
/** Pictures larger than this are not kept. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Text longer than this is not kept. */
export const MAX_TEXT_BYTES = 1024 * 1024;

export type EntryKind = "text" | "image" | "files";

export interface ClipEntry {
  id: string;
  kind: EntryKind;
  /** The type it was read as, and is written back as. */
  mime: string;
  /** The text; for files, the URI list as it came. */
  text?: string;
  /** A picture's file name in `images/`. */
  image?: string;
  size?: Size;
  /** What the app that had the keyboard is called. */
  app: string | null;
  appId?: string;
  copiedAt: number;
  pinned?: true;
}

/** A copy not kept, and why (never what it was). */
export interface Skip {
  reason: SkipReason;
  app: string | null;
  at: number;
}

export interface HistorySnapshot {
  entries: readonly ClipEntry[];
  skipped: readonly Skip[];
}

/** A new copy: what it is; the id, the time, and dedupe are the history's. */
export type NewCopy = Omit<ClipEntry, "id" | "copiedAt" | "image" | "pinned"> & { imageBytes?: Uint8Array };

export function clipboardDir(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_STATE_HOME || join(home, ".local/state"), "dashi", "clipboard");
}

/** The id a copy is kept under: the same content is the same copy. */
export function copyId(kind: EntryKind, content: string | Uint8Array): string {
  return createHash("sha256").update(kind).update("\0").update(content).digest("hex").slice(0, 32);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** One kept entry read back from the file; null for anything malformed (an edit by hand). */
export function parseEntry(value: unknown): ClipEntry | null {
  if (!isRecord(value)) return null;
  const { id, kind, mime, text, image, size, app, appId, copiedAt, pinned } = value;
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) return null;
  if (kind !== "text" && kind !== "image" && kind !== "files") return null;
  if (typeof mime !== "string" || typeof copiedAt !== "number" || !Number.isFinite(copiedAt)) return null;
  if (kind === "image" ? typeof image !== "string" || !/^[0-9a-f]{32}\.[a-z]{3,4}$/.test(image) : typeof text !== "string") return null;
  const dims = isRecord(size) && typeof size.width === "number" && typeof size.height === "number" ? { width: size.width, height: size.height } : null;
  return {
    id,
    kind,
    mime,
    ...(typeof text === "string" ? { text } : {}),
    ...(typeof image === "string" ? { image } : {}),
    ...(dims ? { size: dims } : {}),
    app: typeof app === "string" ? app : null,
    ...(typeof appId === "string" ? { appId } : {}),
    copiedAt,
    ...(pinned === true ? { pinned: true as const } : {}),
  };
}

/**
 * What is left once the limits apply at `now`: no unpinned copy older than
 * 7 days, and at most 200 copies, the oldest unpinned going first.
 */
export function prune(entries: readonly ClipEntry[], now: number, max = MAX_ENTRIES, maxAge = MAX_AGE_MS): ClipEntry[] {
  const fresh = entries.filter((entry) => entry.pinned || now - entry.copiedAt <= maxAge);
  let over = fresh.length - max;
  if (over <= 0) return fresh;
  const kept: ClipEntry[] = [];
  for (let at = fresh.length - 1; at >= 0; at--) {
    const entry = fresh[at] as ClipEntry;
    if (over > 0 && !entry.pinned) {
      over--;
      continue;
    }
    kept.unshift(entry);
  }
  return kept;
}

export interface HistoryOptions {
  dir?: string;
  now?: () => number;
  /** Write the file at once (tests); otherwise a moment after the last change. */
  sync?: boolean;
}

export class ClipboardHistory {
  readonly dir: string;
  private readonly now: () => number;
  private readonly sync: boolean;
  private snapshot: HistorySnapshot = { entries: [], skipped: [] };
  private readonly listeners = new Set<() => void>();
  private saving: ReturnType<typeof setTimeout> | null = null;

  constructor(options: HistoryOptions = {}) {
    this.dir = options.dir ?? clipboardDir();
    this.now = options.now ?? Date.now;
    this.sync = options.sync ?? false;
    this.snapshot = { entries: prune(this.load(), this.now()), skipped: [] };
  }

  get imagesDir(): string {
    return join(this.dir, "images");
  }

  /** A picture's path on disk. */
  imagePath(entry: Pick<ClipEntry, "image">): string | null {
    return entry.image ? join(this.imagesDir, entry.image) : null;
  }

  private load(): ClipEntry[] {
    try {
      const value: unknown = JSON.parse(readFileSync(join(this.dir, "history.json"), "utf8"));
      const list = isRecord(value) && Array.isArray(value.entries) ? value.entries : [];
      return list.map(parseEntry).filter((entry): entry is ClipEntry => entry !== null);
    } catch {
      return [];
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): HistorySnapshot => this.snapshot;

  get(id: string): ClipEntry | undefined {
    return this.snapshot.entries.find((entry) => entry.id === id);
  }

  private set(entries: readonly ClipEntry[], skipped = this.snapshot.skipped, save = true): void {
    const now = this.now();
    const kept = prune(entries, now);
    const gone = this.snapshot.entries.filter((entry) => !kept.some((each) => each.id === entry.id));
    for (const entry of gone) this.removeImage(entry);
    this.snapshot = { entries: kept, skipped: skipped.filter((skip) => now - skip.at <= MAX_AGE_MS) };
    if (save) this.scheduleSave();
    for (const listener of this.listeners) listener();
  }

  /** A copy to keep: on top, or moved there if it is kept already. Returns its entry. */
  add(copy: NewCopy): ClipEntry | null {
    const content = copy.imageBytes ?? copy.text ?? "";
    if (copy.kind === "image" ? !copy.imageBytes || copy.imageBytes.length > MAX_IMAGE_BYTES : (copy.text ?? "").length > MAX_TEXT_BYTES) return null;
    if (content.length === 0) return null;
    const id = copyId(copy.kind, content);
    const before = this.get(id);
    const { imageBytes, ...rest } = copy;
    let image: string | undefined;
    if (imageBytes) {
      image = `${id}.${extensionFor(rest.mime)}`;
      if (!before && !this.writeImage(image, imageBytes)) return null;
      image = before?.image ?? image;
    }
    const entry: ClipEntry = {
      ...rest,
      id,
      ...(image ? { image } : {}),
      copiedAt: this.now(),
      ...(before?.pinned ? { pinned: true as const } : {}),
    };
    this.set([entry, ...this.snapshot.entries.filter((each) => each.id !== id)]);
    return entry;
  }

  /** A copy not kept: counted, never kept. */
  skipped(reason: SkipReason, app: string | null): void {
    this.set(this.snapshot.entries, [...this.snapshot.skipped, { reason, app, at: this.now() }].slice(-50), false);
  }

  pin(id: string, on: boolean): void {
    this.set(
      this.snapshot.entries.map((entry) => {
        if (entry.id !== id) return entry;
        const { pinned: _pinned, ...rest } = entry;
        return on ? { ...rest, pinned: true as const } : rest;
      }),
    );
  }

  delete(id: string): void {
    this.set(this.snapshot.entries.filter((entry) => entry.id !== id));
  }

  /** Every copy, pinned ones too, and the count of those not kept. */
  clear(): void {
    this.set([], []);
  }

  /** Apply the limits again (once an hour, so a week-old copy goes even with nothing new). */
  expire(): void {
    if (prune(this.snapshot.entries, this.now()).length !== this.snapshot.entries.length) this.set(this.snapshot.entries);
  }

  private ensureDir(dir: string): void {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }

  private writeImage(name: string, bytes: Uint8Array): boolean {
    try {
      this.ensureDir(this.dir);
      this.ensureDir(this.imagesDir);
      writeFileSync(join(this.imagesDir, name), bytes, { mode: 0o600 });
      return true;
    } catch (error) {
      console.error("dashi-shell: clipboard history could not keep a picture:", error);
      return false;
    }
  }

  private removeImage(entry: ClipEntry): void {
    if (!entry.image) return;
    rmSync(join(this.imagesDir, entry.image), { force: true });
  }

  private scheduleSave(): void {
    if (this.sync) return this.save();
    if (this.saving) clearTimeout(this.saving);
    this.saving = setTimeout(() => {
      this.saving = null;
      this.save();
    }, 500);
  }

  /** Write the file now: atomically, 0600. */
  save(): void {
    try {
      this.ensureDir(this.dir);
      const path = join(this.dir, "history.json");
      const temp = `${path}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify({ version: 1, entries: this.snapshot.entries })}\n`, { mode: 0o600 });
      renameSync(temp, path);
    } catch (error) {
      console.error("dashi-shell: clipboard history could not be saved:", error);
    }
  }

  /** Save what is pending (the shell stopping). */
  flush(): void {
    if (!this.saving) return;
    clearTimeout(this.saving);
    this.saving = null;
    this.save();
  }
}
