/**
 * The windows' memory on disk (memory.ts): `$XDG_CONFIG_HOME/dashi/windows.json`,
 * 0600, read once at start and written whole, atomically, after each change
 * (the changes of one turn of the loop, an app quitting with all its
 * windows, written once). Outside data: parsed, never trusted (H7); a
 * missing or damaged file is no memory, never an error.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeTextAtomic } from "../../shared/fs/index.ts";
import { memoryText, parseMemory, type WindowMemory, withMemory } from "./memory.ts";

/** The file is never read past this. */
const MOST_BYTES = 256 * 1024;

export function memoryPath(env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir()): string {
  const config = env.XDG_CONFIG_HOME?.startsWith("/") ? env.XDG_CONFIG_HOME : join(home, ".config");
  return join(config, "dashi", "windows.json");
}

export class MemoryFile {
  private memories: Map<string, WindowMemory>;
  private dirty = false;

  constructor(
    private readonly path: string | null = memoryPath(),
    private readonly write: (path: string, text: string) => void = writeText,
  ) {
    this.memories = path ? readMemory(path) : new Map();
  }

  /** The memory of `appId`'s last window, if any. */
  get(appId: string): WindowMemory | null {
    return this.memories.get(appId) ?? null;
  }

  /** Keep `memory` as `appId`'s; written by the end of this turn of the loop. */
  set(appId: string, memory: WindowMemory): void {
    this.memories = withMemory(this.memories, appId, memory);
    if (this.dirty || !this.path) return;
    this.dirty = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.dirty = false;
    if (!this.path) return;
    try {
      this.write(this.path, memoryText(this.memories));
    } catch (error) {
      console.error("dashi-shell: could not keep where windows were:", error instanceof Error ? error.message : error);
    }
  }
}

function readMemory(path: string): Map<string, WindowMemory> {
  try {
    const text = readFileSync(path, "utf8");
    return text.length > MOST_BYTES ? new Map() : parseMemory(JSON.parse(text));
  } catch {
    return new Map();
  }
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeTextAtomic(path, text);
}
