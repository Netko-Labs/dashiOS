/**
 * What Preview remembers between windows: the files opened lately (File ›
 * Open Recent, and the empty window's list), and how each file was rotated,
 * so a rotation sticks: it is a view of the file, kept by Preview, never
 * written into the file (Export writes a rotated copy). It lives in
 * `$XDG_STATE_HOME/dashi/preview/memory.json`; it is history, not a setting.
 *
 * Every Preview window is its own process, so a save reads the file again
 * and applies only this window's change before writing it whole (a rename,
 * so a reader never sees half of it). A rotation is kept with the file's
 * size and modification time: when the file changes, the rotation is
 * forgotten, since the picture may already be upright.
 */

import { type FSWatcher, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** How many recent files are kept, and how many rotations. */
export const MAX_RECENTS = 10;
export const MAX_TURNS = 500;

export interface Recent {
  path: string;
  openedMs: number;
}

export interface KeptTurn {
  /** Quarter turns clockwise, 1 to 3. */
  turns: number;
  /** The file as it was when it was rotated. */
  size: number;
  mtimeMs: number;
}

export interface Memory {
  recents: Recent[];
  /** By path, the oldest first. */
  turns: Record<string, KeptTurn>;
}

/** `$XDG_STATE_HOME/dashi/preview/memory.json`; an empty variable counts as unset. */
export function memoryPath(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_STATE_HOME || join(home, ".local", "state"), "dashi", "preview", "memory.json");
}

const isPath = (value: unknown): value is string => typeof value === "string" && value.startsWith("/") && !value.includes("\0") && value.length < 4096;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** The memory a file holds; anything odd in it is left out, and a file that isn't one is empty. */
export function parseMemory(text: string): Memory {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { recents: [], turns: {} };
  }
  if (typeof value !== "object" || value === null) return { recents: [], turns: {} };
  const fields = value as Record<string, unknown>;
  const recents: Recent[] = [];
  if (Array.isArray(fields.recents)) {
    for (const entry of fields.recents) {
      if (typeof entry !== "object" || entry === null) continue;
      const { path, openedMs } = entry as Record<string, unknown>;
      if (isPath(path) && isCount(openedMs) && !recents.some((recent) => recent.path === path)) recents.push({ path, openedMs });
    }
  }
  const turns: Record<string, KeptTurn> = {};
  if (typeof fields.turns === "object" && fields.turns !== null && !Array.isArray(fields.turns)) {
    for (const [path, entry] of Object.entries(fields.turns as Record<string, unknown>)) {
      if (!isPath(path) || typeof entry !== "object" || entry === null) continue;
      const kept = entry as Record<string, unknown>;
      if (Number.isInteger(kept.turns) && (kept.turns as number) >= 1 && (kept.turns as number) <= 3 && isCount(kept.size) && isCount(kept.mtimeMs)) {
        turns[path] = { turns: kept.turns as number, size: kept.size as number, mtimeMs: kept.mtimeMs as number };
      }
    }
  }
  return { recents: recents.slice(0, MAX_RECENTS), turns };
}

/** `path` opened now: first in the list, once. */
export function withRecent(memory: Memory, path: string, now: number): Memory {
  return { ...memory, recents: [{ path, openedMs: now }, ...memory.recents.filter((recent) => recent.path !== path)].slice(0, MAX_RECENTS) };
}

export function withoutRecents(memory: Memory): Memory {
  return { ...memory, recents: [] };
}

/** The rotation of `path` in this state of the file; 0 forgets it. The newest is kept last, and the oldest go past MAX_TURNS. */
export function withTurns(memory: Memory, path: string, turns: number, file: { size: number; mtimeMs: number }): Memory {
  const rest = Object.entries(memory.turns).filter(([each]) => each !== path);
  const quarter = ((Math.trunc(turns) % 4) + 4) % 4;
  if (quarter !== 0) rest.push([path, { turns: quarter, size: file.size, mtimeMs: Math.floor(file.mtimeMs) }]);
  return { ...memory, turns: Object.fromEntries(rest.slice(-MAX_TURNS)) };
}

/** The rotation kept for `path`, if the file is still as it was. */
export function keptTurns(memory: Memory, path: string, file: { size: number; mtimeMs: number }): number {
  const kept = memory.turns[path];
  return kept && kept.size === file.size && kept.mtimeMs === Math.floor(file.mtimeMs) ? kept.turns : 0;
}

/** The memory file, read and written. */
export class MemoryStore {
  private memory: Memory = { recents: [], turns: {} };

  constructor(
    private readonly file: string | null = memoryPath(),
    private readonly now: () => number = Date.now,
  ) {
    this.memory = this.read();
  }

  private read(): Memory {
    if (this.file === null) return this.memory;
    try {
      return parseMemory(readFileSync(this.file, "utf8"));
    } catch {
      return { recents: [], turns: {} };
    }
  }

  /** Apply a change to what is on disk now (another window may have written since), keep it, and write it. */
  private change(apply: (memory: Memory) => Memory): void {
    this.memory = apply(this.file === null ? this.memory : this.read());
    if (this.file === null) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const partial = `${this.file}.${process.pid}.part`;
      writeFileSync(partial, `${JSON.stringify(this.memory)}\n`, { mode: 0o600 });
      renameSync(partial, this.file);
    } catch {
      // Nowhere to write: it is remembered for this window only.
    }
  }

  /** The recent files, newest first (read again, so another window's opens are in it). */
  recents(): Recent[] {
    this.memory = this.read();
    return this.memory.recents;
  }

  turnsFor(path: string, file: { size: number; mtimeMs: number }): number {
    this.memory = this.read();
    return keptTurns(this.memory, path, file);
  }

  opened(path: string): void {
    this.change((memory) => withRecent(memory, path, this.now()));
  }

  clearRecents(): void {
    this.change(withoutRecents);
  }

  rotated(path: string, turns: number, file: { size: number; mtimeMs: number }): void {
    this.change((memory) => withTurns(memory, path, turns, file));
  }

  /**
   * Hear when another window (or this one) writes the file, a burst once, so
   * this window's recent files follow every window's opens. Its folder is
   * watched (a write is a rename into it), made first if need be. Returns
   * the way to stop; nothing to watch keeps memory in this window only.
   */
  watch(onChange: () => void, settleMs = 100): () => void {
    if (this.file === null) return () => {};
    const file = this.file;
    let watcher: FSWatcher | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      watcher = watch(dirname(file), { persistent: false }, (_, name) => {
        if (name !== null && name !== basename(file)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(onChange, settleMs);
      });
      watcher.on("error", () => watcher?.close());
    } catch {
      // Not watchable: the list is read again at each open.
    }
    return () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
    };
  }
}
