/**
 * The applet client's connection to the shell (client.ts): connect, say when
 * it opens, closes or sends a line, and try again a little later when the shell
 * is not there. It knows nothing of the protocol's messages.
 */

import { existsSync } from "node:fs";
import type { AppletsClientOptions, ClientSocket, SocketHandlers } from "./client-types.ts";

const RETRY_MS = [500, 1000, 2000, 4000, 8000, 15000] as const;

function bunConnect(path: string, handlers: SocketHandlers): void {
  void Bun.connect({
    unix: path,
    socket: {
      open: (socket) => handlers.open(socket),
      data: (_socket, data) => handlers.data(data),
      drain: () => handlers.drain(),
      close: () => handlers.close(),
      error: () => handlers.close(),
      connectError: () => handlers.close(),
    },
  }).catch(() => handlers.close());
}

function unrefTimeout(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

function refTimeout(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
}

/** Splits a byte stream into lines. */
class Lines {
  private pending = "";
  private readonly decoder = new TextDecoder();

  push(chunk: Uint8Array): string[] {
    this.pending += this.decoder.decode(chunk, { stream: true });
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    return lines.filter((line) => line.trim() !== "");
  }
}

/** What the client does when the connection speaks. */
export interface WireEvents {
  /** Whether there is anything to send yet (no applet shown: no connection). */
  wanted(): boolean;
  /** Connected: say hello and send everything again. */
  opened(): void;
  /** One line from the shell. */
  line(line: string): void;
  /** The connection is gone (the wire tries again by itself). */
  lost(): void;
}

export class Wire {
  private socket: ClientSocket | null = null;
  private connecting = false;
  private unsent = new Uint8Array();
  private retries = 0;
  private cancelRetry: (() => void) | null = null;
  private closed = false;
  private readonly connect: NonNullable<AppletsClientOptions["connect"]>;
  private readonly exists: NonNullable<AppletsClientOptions["exists"]>;
  readonly later: NonNullable<AppletsClientOptions["later"]>;

  constructor(
    private readonly options: AppletsClientOptions,
    private readonly events: WireEvents,
  ) {
    this.connect = options.connect ?? bunConnect;
    this.exists = options.exists ?? existsSync;
    this.later = options.later ?? (options.keepAlive ? refTimeout : unrefTimeout);
  }

  /** Whether the shell is listening (a Dashi session). */
  get available(): boolean {
    return this.options.path !== null && this.exists(this.options.path);
  }

  get connected(): boolean {
    return this.socket !== null;
  }

  close(): void {
    this.closed = true;
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.socket?.end();
    this.socket = null;
  }

  /** Tries again a little later, longer each time: the shell may be restarting (its socket gone for a moment). */
  private retry(): void {
    if (this.closed || this.cancelRetry) return;
    const wait = RETRY_MS[Math.min(this.retries++, RETRY_MS.length - 1)] ?? 15000;
    this.cancelRetry = this.later(() => {
      this.cancelRetry = null;
      this.start();
    }, wait);
  }

  start(): void {
    if (this.closed || this.connecting || this.socket || !this.events.wanted() || this.options.path === null) return;
    // No shell listening yet (a session starting or restarting): wait for one, rather than give up.
    if (!this.available) return this.retry();
    this.connecting = true;
    const lines = new Lines();
    let done = false;
    this.connect(this.options.path, {
      open: (socket) => {
        this.connecting = false;
        this.socket = socket;
        this.retries = 0;
        this.unsent = new Uint8Array();
        this.events.opened();
      },
      data: (chunk) => {
        for (const line of lines.push(chunk)) this.events.line(line);
      },
      drain: () => this.flush(),
      close: () => {
        if (done) return;
        done = true;
        this.connecting = false;
        this.socket = null;
        this.events.lost();
        this.retry();
      },
    });
  }

  write(line: string): void {
    this.options.onMessage?.("out", line.trimEnd());
    const bytes = new TextEncoder().encode(line);
    const joined = new Uint8Array(this.unsent.byteLength + bytes.byteLength);
    joined.set(this.unsent);
    joined.set(bytes, this.unsent.byteLength);
    this.unsent = joined;
    this.flush();
  }

  private flush(): void {
    if (!this.socket || this.unsent.byteLength === 0) return;
    const written = Math.max(this.socket.write(this.unsent), 0);
    this.unsent = this.unsent.subarray(written);
  }
}
