/** A widget's data as a small store: a snapshot, listeners, and a start that returns its stop. */

export class Source<T> {
  private readonly listeners = new Set<() => void>();

  constructor(private value: T) {}

  getSnapshot = (): T => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  protected set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  }
}
