/**
 * A value that counts only once it has held: the power source for the
 * refresh rate (auto-refresh.ts), so a loose charger that drops out for a
 * moment doesn't flick the screen between rates. The first value counts at
 * once (login); after that a new value counts after `ms` without another
 * change, and a value that goes back before then never counted at all.
 */

export type Later = (fn: () => void, ms: number) => () => void;

const later: Later = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export class Steady<T> {
  private settled: { value: T } | null = null;
  private waiting: { value: T; cancel: () => void } | null = null;

  constructor(
    private readonly ms: number,
    private readonly onSettle: (value: T) => void,
    private readonly schedule: Later = later,
  ) {}

  /** The value that counts now; null before the first. */
  get value(): T | null {
    return this.settled?.value ?? null;
  }

  /** The value now, as often as it is read (the same value again changes nothing, and doesn't restart the wait). */
  set(value: T): void {
    if (!this.settled) {
      this.settle(value);
      return;
    }
    if (this.waiting && Object.is(this.waiting.value, value)) return;
    this.waiting?.cancel();
    this.waiting = null;
    if (Object.is(this.settled.value, value)) return;
    const cancel = this.schedule(() => {
      this.waiting = null;
      this.settle(value);
    }, this.ms);
    this.waiting = { value, cancel };
  }

  close(): void {
    this.waiting?.cancel();
    this.waiting = null;
  }

  private settle(value: T): void {
    this.settled = { value };
    this.onSettle(value);
  }
}
