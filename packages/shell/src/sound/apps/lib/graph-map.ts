/**
 * PipeWire's objects as `pw-dump --monitor` keeps telling them: it prints a
 * JSON array of every object, then, as things change, an array of only the
 * objects that changed (each one whole), with `"info": null` for one that
 * went. Its arrays are indented across many lines, so `JsonArrays` puts the
 * lines back into whole arrays by counting brackets outside strings, and
 * `GraphMap` keeps the latest of each object by id. Pure: no process here
 * (watch.ts runs pw-dump).
 *
 * A metadata object is the exception: an update lists only the entries that
 * changed (`wpctl set-default` sends `default.audio.sink`, then
 * `default.configured.audio.sink`, each alone), so its entries are merged
 * by subject and key. An entry taken away isn't listed at all (its update
 * has fewer entries, often none), so a metadata update is noted
 * (`takeMetadata`) and watch.ts reads that object again whole.
 */

import { isRecord } from "./objects.ts";

/** Whole top-level JSON arrays out of the lines of a stream. */
export class JsonArrays {
  private text = "";
  private depth = 0;
  private quoted = false;
  private escaped = false;

  /** The arrays this line completes (usually none, or one). */
  push(line: string): string[] {
    const done: string[] = [];
    let start = 0;
    for (let at = 0; at < line.length; at++) {
      const char = line[at];
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (char === "\\") this.escaped = true;
        else if (char === '"') this.quoted = false;
        continue;
      }
      if (char === '"') this.quoted = true;
      else if (char === "[" || char === "{") this.depth++;
      else if (char === "]" || char === "}") {
        this.depth--;
        if (this.depth === 0) {
          done.push(this.text + line.slice(start, at + 1));
          this.text = "";
          start = at + 1;
        } else if (this.depth < 0) {
          // Not a dump: start over.
          this.reset();
          start = at + 1;
        }
      } else if (this.depth === 0 && char !== " " && char !== "\t" && char !== "\r") {
        // Text outside an array (a warning on stdout): skipped.
        start = at + 1;
      }
    }
    if (this.depth > 0) this.text += `${line.slice(start)}\n`;
    return done;
  }

  reset(): void {
    this.text = "";
    this.depth = 0;
    this.quoted = false;
    this.escaped = false;
  }
}

/** The objects by id, as the dump and its updates leave them. */
type Json = Record<string, unknown>;

const entryKey = (entry: unknown): string | null =>
  isRecord(entry) && typeof entry.key === "string" ? `${typeof entry.subject === "number" ? entry.subject : ""}\u0000${entry.key}` : null;

/** The entries of `before` with `changes` laid over them, by subject and key; a change whose value is null takes its entry away. */
function mergeEntries(before: readonly unknown[], changes: readonly unknown[]): unknown[] {
  const merged = new Map<string, unknown>();
  for (const entry of before) {
    const key = entryKey(entry);
    if (key !== null) merged.set(key, entry);
  }
  for (const entry of changes) {
    const key = entryKey(entry);
    if (key === null) continue;
    if (isRecord(entry) && entry.value === null) merged.delete(key);
    else merged.set(key, entry);
  }
  return [...merged.values()];
}

export class GraphMap {
  private readonly objects = new Map<number, Json>();
  private readonly metadataSeen = new Set<number>();

  /**
   * Applies one array of the monitor's; whether anything changed. Text that
   * isn't a JSON array changes nothing. `whole`: the array is a fresh read,
   * so a metadata object's entries replace what was kept instead of being
   * merged into it.
   */
  apply(arrayText: string, options: { whole?: boolean } = {}): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(arrayText);
    } catch {
      return false;
    }
    if (!Array.isArray(parsed)) return false;
    let changed = false;
    for (const object of parsed) {
      if (!isRecord(object) || typeof object.id !== "number") continue;
      // A removed object comes as its id and `"info": null` (`"props": null` for one without info); a metadata object keeps its entries outside `info`.
      if ((object.info === null || object.props === null) && object.metadata === undefined) {
        changed = this.objects.delete(object.id) || changed;
        continue;
      }
      const before = this.objects.get(object.id);
      if (Array.isArray(object.metadata) && !options.whole && before && Array.isArray(before.metadata)) {
        this.objects.set(object.id, { ...object, metadata: mergeEntries(before.metadata, object.metadata) });
        this.metadataSeen.add(object.id);
      } else {
        this.objects.set(object.id, object);
      }
      changed = true;
    }
    return changed;
  }

  /** The metadata objects an update touched since the last call: their entries may have lost one, so read them again. */
  takeMetadata(): number[] {
    const ids = [...this.metadataSeen];
    this.metadataSeen.clear();
    return ids;
  }

  clear(): void {
    this.objects.clear();
    this.metadataSeen.clear();
  }

  values(): Record<string, unknown>[] {
    return [...this.objects.values()];
  }
}
