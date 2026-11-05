/**
 * The guard against write loops. When Dashi writes the platform profile (or
 * tuned-ppd's profile), the watchers hear that change back a moment later:
 * an echo, not a key press. Each write leaves an expectation; the first
 * change that matches it is the echo and is used up, and an expectation
 * nobody answered expires. Anything else is someone else's change.
 */

export const ECHO_MS = 5000;

export type EchoKind = "platform-profile" | "profile";

export class EchoGuard {
  private readonly expected: Array<{ kind: EchoKind; value: string; until: number }> = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** Dashi is about to write `value`. */
  expect(kind: EchoKind, value: string): void {
    this.expected.push({ kind, value, until: this.now() + ECHO_MS });
  }

  /** Whether a change to `value` is the echo of Dashi's own write (and uses that up). */
  isEcho(kind: EchoKind, value: string): boolean {
    const now = this.now();
    for (let index = this.expected.length - 1; index >= 0; index--) {
      if ((this.expected[index]?.until ?? 0) < now) this.expected.splice(index, 1);
    }
    const index = this.expected.findIndex((entry) => entry.kind === kind && entry.value === value);
    if (index < 0) return false;
    this.expected.splice(index, 1);
    return true;
  }
}
