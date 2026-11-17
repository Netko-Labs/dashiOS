/**
 * Forms' drafts (frame L8: "A draft is kept if you close the launcher"): what
 * was typed in a form whose root says `draft`, by extension and command, in
 * `applet-data/<id>.drafts.json`, beside its data folder and outside its
 * sandbox. Written as it is typed; gone once the form was sent and the
 * extension closed the view.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type FieldValue, fieldValueOf } from "@dashi/applet";
import { isRecord } from "@dashi/shape";

export interface Drafts {
  read(extension: string, command: string): Record<string, FieldValue>;
  /** Keeps `values` for the command; null forgets them. */
  write(extension: string, command: string, values: Readonly<Record<string, FieldValue>> | null): void;
}

export class DraftFiles implements Drafts {
  constructor(private readonly dataRoot: string) {}

  private file(extension: string): string {
    return join(this.dataRoot, `${extension}.drafts.json`);
  }

  private all(extension: string): Record<string, unknown> {
    const path = this.file(extension);
    if (!existsSync(path)) return {};
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      return isRecord(value) ? value : {};
    } catch {
      return {};
    }
  }

  read(extension: string, command: string): Record<string, FieldValue> {
    const kept = this.all(extension)[command];
    const out: Record<string, FieldValue> = {};
    if (!isRecord(kept)) return out;
    for (const [name, value] of Object.entries(kept)) {
      const parsed = fieldValueOf(value);
      if (parsed !== null) out[name] = parsed;
    }
    return out;
  }

  write(extension: string, command: string, values: Readonly<Record<string, FieldValue>> | null): void {
    const all = this.all(extension);
    if (values === null) delete all[command];
    else all[command] = values;
    const path = this.file(extension);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(all), { mode: 0o600 });
  }
}

/** Drafts in memory, for tests. */
export const draftsInMemory = (): Drafts & { held: Map<string, Record<string, FieldValue>> } => {
  const held = new Map<string, Record<string, FieldValue>>();
  return {
    held,
    read: (extension, command) => ({ ...held.get(`${extension}/${command}`) }),
    write: (extension, command, values) => {
      if (values === null) held.delete(`${extension}/${command}`);
      else held.set(`${extension}/${command}`, { ...values });
    },
  };
};
