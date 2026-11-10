/**
 * Start-up's bookkeeping (main.tsx): what started, so the shell stops it in the
 * reverse order, and the pieces made later than a callback that reaches them.
 *
 * Each piece says how it stops on the line it starts, so the shutdown order is
 * the start-up order backwards and no second list has to mirror the first.
 */

import { type Closer, runClosers } from "../shutdown.ts";

/** Everything start-up started that must stop when the shell ends, in the order it started. */
export class Services {
  private readonly started: Closer[] = [];
  private closed = false;

  /** `name` has started and `stop` ends it. */
  add(name: string, stop: () => void): void {
    this.started.push([name, stop]);
  }

  /** Whether nothing has started stopping yet. */
  isRunning(): boolean {
    return !this.closed;
  }

  /** The names, in the order they started. */
  names(): string[] {
    return this.started.map(([name]) => name);
  }

  /**
   * Stops everything, the last started first, once: a second call does nothing. Each stop runs
   * even when one before it throws (shutdown.ts `runClosers`). Returns the names that threw.
   */
  closeAll(log?: (message: string, error: unknown) => void): string[] {
    if (this.closed) return [];
    this.closed = true;
    return runClosers([...this.started].reverse(), log);
  }
}

/**
 * Pieces start-up makes after something that calls them: the power key asks through the menus,
 * which start later. Reading one before it is made throws, as reading a `const` before its line
 * would; `peek` is for pieces that may never be made, and reads as "not yet".
 */
export class Late<Parts extends object> {
  private readonly parts: Partial<Parts> = {};

  set<Key extends keyof Parts>(key: Key, value: Parts[Key]): Parts[Key] {
    this.parts[key] = value;
    return value;
  }

  get<Key extends keyof Parts>(key: Key): Parts[Key] {
    const value = this.parts[key];
    if (value === undefined && !(key in this.parts)) throw new Error(`dashi-shell: ${String(key)} is used before it has started`);
    return value as Parts[Key];
  }

  peek<Key extends keyof Parts>(key: Key): Parts[Key] | undefined {
    return this.parts[key];
  }
}
