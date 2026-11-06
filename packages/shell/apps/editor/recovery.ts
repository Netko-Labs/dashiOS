/**
 * Changes that aren't saved, kept where a crash can't take them. Each window
 * keeps its document's unsaved text in one file (`RecoveryKeeper`), written
 * a moment after typing stops and again as the window goes, and removed once
 * the text is saved or the person chooses Don't Save. Metal can't hold a
 * window open to ask (its close ends the process), so a window closed by its
 * close button, ❖Q, logging out, or a crash leaves its file behind, in
 * `$XDG_STATE_HOME/dashi/editor/recovery/` (only the person's: 0700 and
 * 0600). The next Text Editor opened without a file brings them back as
 * edited documents, and opening that file brings its own back. A file is
 * taken (read and removed) once, and never from a window still open.
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Encoding, LineEnding } from "./codec.ts";

export interface Recovery {
  /** The file it was opened from, or null for Untitled. */
  path: string | null;
  text: string;
  encoding: Encoding;
  lineEnding: LineEnding;
  /** When it was kept, ms since the epoch. */
  time: number;
}

const ENCODINGS: ReadonlySet<string> = new Set(["utf-8", "utf-8-bom", "utf-16le", "utf-16be", "latin-1"]);
const LINE_ENDINGS: ReadonlySet<string> = new Set(["lf", "crlf", "cr"]);

export function recoveryDir(env: Record<string, string | undefined> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "dashi", "editor", "recovery");
}

/** A recovery file's contents, or null when they are not one. */
export function parseRecovery(text: string): Recovery | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { path, encoding, lineEnding, time } = record;
  if (typeof record.text !== "string") return null;
  if (path !== null && (typeof path !== "string" || path === "" || path.includes("\0"))) return null;
  if (typeof encoding !== "string" || !ENCODINGS.has(encoding)) return null;
  if (typeof lineEnding !== "string" || !LINE_ENDINGS.has(lineEnding)) return null;
  if (typeof time !== "number" || !Number.isFinite(time)) return null;
  return { path, text: record.text, encoding: encoding as Encoding, lineEnding: lineEnding as LineEnding, time };
}

const NAME = /^\d+-(\d+)\.json$/;

/** Writes `recovery` as `name`, whole or not at all (through a temporary file); synchronous, since it also runs as the process exits. */
function writeRecovery(recovery: Recovery, dir: string, name: string): boolean {
  const path = join(dir, name);
  const partial = `${path}.writing`;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(partial, JSON.stringify(recovery), { mode: 0o600 });
    renameSync(partial, path);
    return true;
  } catch {
    rmSync(partial, { force: true });
    return false;
  }
}

/** Keeps `recovery` in a file of its own. Whether it was written. */
export function keepRecovery(recovery: Recovery, dir: string = recoveryDir()): boolean {
  return writeRecovery(recovery, dir, `${recovery.time}-${process.pid}.json`);
}

/** Whether process `pid` is another Text Editor window, still open (its file is still being kept). */
export function isOpenWindow(pid: number): boolean {
  if (pid === process.pid) return false;
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("editor/main.tsx");
  } catch {
    return false;
  }
}

/** The names of the kept files no open window is keeping, oldest first. */
export function recoveryFiles(dir: string = recoveryDir(), isOpen: (pid: number) => boolean = isOpenWindow): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => {
        const match = NAME.exec(name);
        return match !== null && !isOpen(Number(match[1]));
      })
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  } catch {
    return [];
  }
}

/** The newest kept file with changes to `path` that no open window is keeping, or null. */
export function recoveryFor(path: string, dir: string = recoveryDir(), isOpen: (pid: number) => boolean = isOpenWindow): string | null {
  const names = recoveryFiles(dir, isOpen).reverse();
  return (
    names.find((name) => {
      try {
        return parseRecovery(readFileSync(join(dir, name), "utf8"))?.path === path;
      } catch {
        return false;
      }
    }) ?? null
  );
}

export interface KeeperOptions {
  dir?: string;
  /** How long after the last change it writes (ms). */
  delay?: number;
  now?: () => number;
}

/** About two seconds after typing stops. */
export const KEEP_DELAY = 2000;

/**
 * One window's kept file: what `current` says isn't saved, written `delay`
 * after the last change (`changed`) and at once by `flush`; removed when
 * nothing is unsaved any more, or by `discard`.
 */
export class RecoveryKeeper {
  /** The file's name: when the window started, and its process. */
  readonly name: string;
  private readonly dir: string;
  private readonly delay: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** What the file holds now (the recovery without its time), or null when there is no file. */
  private written: string | null = null;

  constructor(
    private readonly current: () => Recovery | null,
    options: KeeperOptions = {},
  ) {
    this.dir = options.dir ?? recoveryDir();
    this.delay = options.delay ?? KEEP_DELAY;
    this.name = `${(options.now ?? Date.now)()}-${process.pid}.json`;
  }

  /** The document changed: keep it once things are quiet. */
  changed(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  /** Keeps what isn't saved now, or removes the file when everything is. Whether the file says what the document does. */
  flush(): boolean {
    this.cancel();
    const recovery = this.current();
    if (!recovery) {
      this.remove();
      return true;
    }
    const { path, text, encoding, lineEnding } = recovery;
    const content = JSON.stringify({ path, text, encoding, lineEnding });
    if (content === this.written) return true;
    if (!writeRecovery(recovery, this.dir, this.name)) return false;
    this.written = content;
    return true;
  }

  /** Don't Save: nothing is kept. */
  discard(): void {
    this.cancel();
    this.remove();
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private remove(): void {
    if (this.written === null) return;
    rmSync(join(this.dir, this.name), { force: true });
    this.written = null;
  }
}

/** Reads and removes one kept file (a bad one is removed too); null when it is gone or bad. */
export function takeRecovery(name: string, dir: string = recoveryDir()): Recovery | null {
  if (!NAME.test(name)) return null;
  // Renamed first, so two windows opening at once never both take it.
  const path = join(dir, name);
  const claimed = `${path}.${process.pid}.taking`;
  let text: string;
  try {
    renameSync(path, claimed);
    text = readFileSync(claimed, "utf8");
    unlinkSync(claimed);
  } catch {
    return null;
  }
  return parseRecovery(text);
}
