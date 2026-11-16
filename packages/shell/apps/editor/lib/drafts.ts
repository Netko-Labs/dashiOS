/**
 * Which drafts a window brings back (recovery.ts), so that one start, or one
 * ❖N, makes one window (decisions.md D310). A window started with no file
 * takes the newest draft no open window keeps; New (❖N, the toolbar's New)
 * takes none; a window opened for one kept file takes that one. The others
 * stay kept, and File › Open Drafts brings them back, one window each, when
 * the person asks.
 */

import { recoveryFiles } from "./recovery.ts";

/** The draft a window starting with these arguments takes, if any: `kept` is oldest first (recoveryFiles). */
export function startingDraft(args: { files: readonly string[]; recover: string | null; fresh: boolean }, kept: readonly string[]): string | null {
  if (args.recover !== null) return args.recover;
  if (args.files.length > 0 || args.fresh) return null;
  return kept.at(-1) ?? null;
}

/** The kept drafts no open window holds, for File › Open Drafts: a count to show, and opening them. */
export class KeptDrafts {
  private names: readonly string[] = [];
  /** Drafts this window has asked a window for: never offered twice while that window starts. */
  private readonly asked = new Set<string>();
  private readonly listeners = new Set<() => void>();

  /** Nothing until the first `refresh`: a starting window takes its own draft first. */
  constructor(private readonly list: () => string[] = () => recoveryFiles()) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** How many there are. */
  getSnapshot = (): number => this.names.length;

  /** Looks at the drafts folder again. */
  refresh(): void {
    const next = this.list().filter((name) => !this.asked.has(name));
    if (next.length === this.names.length && next.every((name, i) => name === this.names[i])) return;
    this.names = next;
    for (const listener of this.listeners) listener();
  }

  /** Opens a window for each (`open` starts one for a kept file's name). */
  openAll(open: (name: string) => void): void {
    this.refresh();
    for (const name of this.names) {
      this.asked.add(name);
      open(name);
    }
    this.refresh();
  }
}
