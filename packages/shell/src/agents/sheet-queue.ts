/**
 * The sheets agents put up, one at a time in the order they asked. A sheet
 * nobody answers must not hold an agent's call forever: two minutes after it
 * is *shown* (not after it was queued behind another) it comes down and
 * counts as "Don't Allow", and only that sheet does. The queue is the
 * logic; agent-sheets/agent-sheets.tsx supplies the Metal surfaces.
 */

import { ASK_TIMEOUT_MS } from "./confirm.ts";
import type { Answer } from "./presence.ts";

/** A sheet waiting its turn, or showing. */
export interface QueuedSheet {
  agent: number;
  resolve(answer: Answer): void;
  /** How long it waits once shown, when not the queue's own time (a question says how long it waits). */
  timeoutMs?: number;
}

export const DENY: Answer = { allow: "deny", scopes: [] };

export interface SheetQueueOptions<E extends QueuedSheet> {
  /**
   * Puts the sheet on screen. `answer` is the person's; `gone` runs if its
   * host died (that is a no). Returns the way to take it down.
   */
  open(entry: E, answer: (answer: Answer) => void, gone: () => void): { close(): void };
  /** Nothing is queued or showing any more. */
  onIdle?(): void;
  timeoutMs?: number;
  /** Runs `fn` later; returns the way to cancel it. */
  later?(fn: () => void, ms: number): () => void;
}

const timeout = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export class SheetQueue<E extends QueuedSheet> {
  private readonly queue: E[] = [];
  private showing: { entry: E; handle: { close(): void } | null; cancel: () => void } | null = null;

  constructor(private readonly options: SheetQueueOptions<E>) {}

  /** Whether a sheet is showing or waiting. */
  get busy(): boolean {
    return this.showing !== null || this.queue.length > 0;
  }

  enqueue(entry: E): void {
    this.queue.push(entry);
    this.showNext();
  }

  /** All of an agent's sheets: it left, or the screen locked. They count as "Don't Allow". */
  dismiss(agent: number): void {
    this.release(
      this.queue.filter((entry) => entry.agent === agent),
      DENY,
    );
    this.showNext();
  }

  /** One sheet whose caller gave up: it comes down (or never shows) as "Don't Allow"; the next comes up. */
  cancel(entry: E): void {
    this.release([entry], DENY);
    this.showNext();
  }

  /** Everything comes down as "Don't Allow". */
  close(): void {
    this.release([...this.queue], DENY);
  }

  private showNext(): void {
    if (this.showing) return;
    const entry = this.queue[0];
    if (!entry) return this.options.onIdle?.();
    const shown: { entry: E; handle: { close(): void } | null; cancel: () => void } = { entry, handle: null, cancel: () => {} };
    this.showing = shown;
    // The clock starts now that the person can see it.
    shown.cancel = (this.options.later ?? timeout)(() => this.finish(entry, DENY), entry.timeoutMs ?? this.options.timeoutMs ?? ASK_TIMEOUT_MS);
    shown.handle = this.options.open(
      entry,
      (answer) => this.finish(entry, answer),
      () => {
        if (this.showing === shown) this.finish(entry, DENY);
      },
    );
    // Taken down while it was being opened (its host died at once).
    if (this.showing !== shown) shown.handle.close();
  }

  /** Answer one sheet and take it down; the next one comes up. */
  private finish(entry: E, answer: Answer): void {
    this.release([entry], answer);
    this.showNext();
  }

  private release(entries: readonly E[], answer: Answer): void {
    for (const entry of entries) {
      const index = this.queue.indexOf(entry);
      if (index < 0) continue;
      this.queue.splice(index, 1);
      if (this.showing?.entry === entry) {
        const closing = this.showing;
        this.showing = null;
        closing.cancel();
        closing.handle?.close();
      }
      entry.resolve(answer);
    }
  }
}
