/** One connection's line-framed JSON: lines in (a runaway client ends it), messages out, held when the socket is full. */

import { LineBuffer } from "../../../shared/io/lines.ts";
import type { Connection } from "./session-types.ts";

/** A line longer than this (a runaway client) ends the connection. */
const MAX_LINE = 8 * 1024 * 1024;

export class Wire {
  private readonly lines = new LineBuffer();
  private outbox: Uint8Array[] = [];

  constructor(
    private readonly connection: Connection,
    /** Whether the session is over: nothing more is read or sent. */
    private readonly closed: () => boolean,
    private readonly onLine: (line: string) => void,
    /** A line that never ends. */
    private readonly onRunaway: () => void,
  ) {}

  receive(chunk: Uint8Array): void {
    // A stopped agent's connection may still deliver what was already on its way.
    if (this.closed()) return;
    const lines = this.lines.push(chunk);
    if (this.lines.pending > MAX_LINE) {
      this.onRunaway();
      return;
    }
    for (const line of lines) {
      // Stopping on one line (a revoked agent, a bad frame) leaves the rest of the chunk unread.
      if (this.closed()) return;
      if (line.trim()) this.onLine(line);
    }
  }

  /** The socket can take more: flush what waited. */
  drain(): void {
    while (this.outbox.length > 0) {
      const next = this.outbox[0] as Uint8Array;
      const written = this.connection.write(next);
      if (written < next.byteLength) {
        this.outbox[0] = next.subarray(Math.max(written, 0));
        return;
      }
      this.outbox.shift();
    }
  }

  send(message: unknown): void {
    if (this.closed()) return;
    this.outbox.push(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
    if (this.outbox.length === 1) this.drain();
  }
}
