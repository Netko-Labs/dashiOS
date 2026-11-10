/**
 * The battery's history on disk: `$XDG_STATE_HOME/dashi/battery-history.jsonl`
 * (`~/.local/state` by default), one sample a line, appended as they come.
 * Reading it drops what is malformed or older than a week, and writes the
 * file again when that left out much, so it never grows past a week's worth.
 * It stays on this machine; nothing sends it anywhere.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseSample, prune, type Sample } from "../history.ts";

export function historyPath(env: Record<string, string | undefined> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "dashi", "battery-history.jsonl");
}

export class HistoryFile {
  constructor(private readonly path: string = historyPath()) {}

  /** The week's samples, oldest first. */
  read(now: number): Sample[] {
    if (!existsSync(this.path)) return [];
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch {
      return [];
    }
    const lines = text.split("\n").filter((line) => line.trim() !== "");
    const kept = prune(
      lines.flatMap((line) => parseSample(line) ?? []),
      now,
    ).sort((a, b) => a.t - b.t);
    // Over a tenth left out (a week went by, or the file was damaged): write it again without them.
    if (lines.length - kept.length > Math.max(lines.length / 10, 10)) this.rewrite(kept);
    return kept;
  }

  append(sample: Sample): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      appendFileSync(this.path, `${JSON.stringify(sample)}\n`, { mode: 0o600 });
    } catch (error) {
      console.error("dashi-shell: battery history not saved:", error instanceof Error ? error.message : error);
    }
  }

  private rewrite(samples: readonly Sample[]): void {
    try {
      const partial = `${this.path}.${process.pid}.part`;
      writeFileSync(partial, samples.map((sample) => `${JSON.stringify(sample)}\n`).join(""), { mode: 0o600 });
      renameSync(partial, this.path);
    } catch (error) {
      console.error("dashi-shell: battery history not trimmed:", error instanceof Error ? error.message : error);
    }
  }
}
