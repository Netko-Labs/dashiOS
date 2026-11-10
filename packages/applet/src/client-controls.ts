/**
 * The applet client's control states (protocol 5, client.ts): each control's
 * whole state as last given, sent at most 4 times a second per control, a newer
 * one waiting replacing the one before, and again whenever the shell says welcome.
 */

import { CONTROL_SPACING_MS } from "./client-types.ts";
import type { ControlUpdate } from "./controls.ts";

/** What the sender needs of the client. */
export interface ControlLink {
  /** Connected to a shell that draws controls. */
  ready(): boolean;
  write(line: string): void;
  later(fn: () => void, ms: number): () => void;
  now(): number;
}

export class ControlSender {
  /** Each control's whole state as last given. */
  private readonly states = new Map<string, ControlUpdate>();
  /** When each control's state last went, and whether a newer one waits for its turn. */
  private readonly sends = new Map<string, { at: number; waiting: (() => void) | null }>();

  constructor(private readonly link: ControlLink) {}

  /** What is given replaces those parts, the rest stays. */
  update(update: ControlUpdate): void {
    this.states.set(update.id, { ...this.states.get(update.id), ...update });
    this.send(update.id);
  }

  /** Every control's state again (the shell said welcome). */
  sendAll(): void {
    for (const id of this.states.keys()) this.send(id);
  }

  /** The shell is gone: states that waited for their turn are dropped (they go again on welcome). */
  drop(): void {
    for (const sent of this.sends.values()) sent.waiting?.();
    this.sends.clear();
  }

  private send(id: string): void {
    if (!this.link.ready()) return;
    const sent = this.sends.get(id);
    if (sent?.waiting) return;
    const wait = sent ? sent.at + CONTROL_SPACING_MS - this.link.now() : 0;
    const go = (): void => {
      const state = this.states.get(id);
      this.sends.set(id, { at: this.link.now(), waiting: null });
      if (state && this.link.ready()) this.link.write(`${JSON.stringify({ type: "control", ...state })}\n`);
    };
    if (wait <= 0) return go();
    this.sends.set(id, { at: sent?.at ?? 0, waiting: this.link.later(go, wait) });
  }
}
