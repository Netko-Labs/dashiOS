/**
 * What a slider, a mute or a menu set a moment ago, shown over PipeWire's
 * word until it has had time to report it: by row (an app's playing side,
 * its recording side, one stream). While the write runs the hold has no
 * end; once it is done it lasts `holdMs` more (for good on a development
 * run, where nothing is written and PipeWire will never say it).
 */

export interface HeldChange {
  level?: number;
  muted?: boolean;
  /** The device chosen: a node.name, or null for the default. */
  target?: string | null;
}

export interface Held extends HeldChange {
  /** Shown over the truth until then; Infinity while a write is running. */
  until: number;
}

export class Holds {
  private readonly held = new Map<string, Held>();

  constructor(
    private readonly now: () => number,
    private readonly holdMs: number,
  ) {}

  /** The row's hold, while it lasts. */
  get(key: string): Held | undefined {
    const held = this.held.get(key);
    return held && held.until > this.now() ? held : undefined;
  }

  /** Lays `change` over what the row already holds, with no end yet. */
  set(key: string, change: HeldChange): void {
    this.held.set(key, { ...this.held.get(key), ...change, until: Number.POSITIVE_INFINITY });
  }

  drop(key: string): void {
    this.held.delete(key);
  }

  /** The row's writes are done: its hold ends `holdMs` from now. */
  release(key: string): void {
    const held = this.held.get(key);
    if (held) held.until = this.now() + this.holdMs;
  }

  /** Lets go of the holds that ended, and of those whose row is gone (`rows`: the rows there are). */
  keep(now: number, rows: readonly string[]): void {
    const there = new Set(rows);
    for (const [key, held] of this.held) if (held.until <= now || !there.has(key)) this.held.delete(key);
  }

  /** When each hold ends. */
  ends(): number[] {
    return [...this.held.values()].map((held) => held.until);
  }
}
