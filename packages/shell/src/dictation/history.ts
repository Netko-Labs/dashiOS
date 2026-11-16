/**
 * What was dictated, kept for the history (Settings › Voice › Dictation;
 * docs/voice.md, "The insertion record"): for each landing, when, in which
 * app, the words as the recogniser gave them and the words that were typed.
 * One JSON line each in `$XDG_STATE_HOME/dashi/dictation/history.jsonl`,
 * readable by the person alone. The last day by default; "keep nothing"
 * writes nothing and removes what was kept. No audio is kept.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Infer, maybe, num, obj, optional, str } from "@dashi/shape";
import type { HistoryKeep } from "../shared/pill/index.ts";

const Entry = obj(
  {
    id: str(),
    at: num(),
    /** The app's name, as the person knows it ("Text Editor"); "" when not known. */
    app: str(),
    /** The profile that tidied it ("Developer"). */
    profile: str(),
    heard: str(),
    typed: str(),
    /** What the person did with it after: taken back, or the raw words landed instead. */
    after: optional(str()),
    /** What the correction model said of it, when it was asked: "text", "unchanged", or why it failed. */
    model: optional(str()),
  },
  { strict: false },
);

export type HistoryEntry = Infer<typeof Entry>;

const KEEP_MS: Readonly<Record<HistoryKeep, number>> = { none: 0, day: 86_400_000, week: 7 * 86_400_000 };
/** However long it is kept, never more than this many. */
const MOST = 2000;

export const historyFile = (): string => join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "dashi", "dictation", "history.jsonl");

export interface HistoryOptions {
  file?: string;
  keep(): HistoryKeep;
  now?(): number;
}

export class DictationHistory {
  private readonly file: string;
  private entries: HistoryEntry[] | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly HistoryEntry[] = [];

  constructor(private readonly options: HistoryOptions) {
    this.file = options.file ?? historyFile();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private read(): HistoryEntry[] {
    if (this.entries) return this.entries;
    let text = "";
    try {
      text = readFileSync(this.file, "utf8");
    } catch {}
    const entries: HistoryEntry[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const entry = maybe(Entry, JSON.parse(line));
        if (entry) entries.push(entry);
      } catch {}
    }
    this.entries = entries;
    return entries;
  }

  /** What is older than the person keeps goes; whether anything went. */
  private prune(): boolean {
    const entries = this.read();
    const keep = this.options.keep();
    const oldest = this.now() - KEEP_MS[keep];
    const kept = keep === "none" ? [] : entries.filter((entry) => entry.at > oldest).slice(-MOST);
    this.entries = kept;
    return kept.length !== entries.length;
  }

  private write(): void {
    const entries = this.read();
    try {
      if (entries.length === 0) {
        if (existsSync(this.file)) rmSync(this.file);
      } else {
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
        writeFileSync(this.file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, { mode: 0o600 });
        chmodSync(this.file, 0o600);
      }
    } catch (error) {
      console.error("dashi-shell: dictation's history could not be written:", error);
    }
    this.snapshot = [...entries].reverse();
    for (const listener of [...this.listeners]) listener();
  }

  /** A landing, kept unless the person keeps nothing. */
  add(entry: HistoryEntry): void {
    this.prune();
    if (this.options.keep() !== "none") this.read().push(entry);
    this.write();
  }

  /** What became of a landing: "undone", "raw", "refined". */
  mark(id: string, after: string): void {
    const entry = this.read().find((each) => each.id === id);
    if (!entry) return;
    entry.after = after;
    this.write();
  }

  remove(id: string): void {
    this.entries = this.read().filter((entry) => entry.id !== id);
    this.write();
  }

  clear(): void {
    this.entries = [];
    this.write();
  }

  /** The setting changed (or time passed): drop what is no longer kept. */
  refresh(): void {
    if (this.prune()) this.write();
    else this.snapshot = [...this.read()].reverse();
  }

  /** The newest first. */
  getSnapshot = (): readonly HistoryEntry[] => {
    if (!this.entries) this.refresh();
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
}
