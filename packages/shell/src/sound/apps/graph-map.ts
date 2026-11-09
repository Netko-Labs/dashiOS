/**
 * PipeWire's objects as `pw-dump --monitor` keeps telling them: it prints a
 * JSON array of every object, then, as things change, an array of only the
 * objects that changed (each one whole), with `"info": null` for one that
 * went. Its arrays are indented across many lines, so `JsonArrays` puts the
 * lines back into whole arrays by counting brackets outside strings, and
 * `GraphMap` keeps the latest of each object by id. Pure: no process here
 * (watch.ts runs pw-dump).
 */

import { isRecord } from "./streams.ts";

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
export class GraphMap {
  private readonly objects = new Map<number, Record<string, unknown>>();

  /** Applies one array of the monitor's; whether anything changed. Text that isn't a JSON array changes nothing. */
  apply(arrayText: string): boolean {
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
      this.objects.set(object.id, object);
      changed = true;
    }
    return changed;
  }

  clear(): void {
    this.objects.clear();
  }

  values(): Record<string, unknown>[] {
    return [...this.objects.values()];
  }
}
