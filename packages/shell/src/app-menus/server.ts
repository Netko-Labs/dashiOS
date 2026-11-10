/**
 * The shell's end of the menus channel (protocol.ts): a socket only this
 * user can reach (mode 0600 in the runtime directory), one connection per
 * app. Who connected is the kernel's word (SO_PEERCRED through bun:ffi,
 * agents/peer.ts), never the app's: its menus go with that process, and a
 * connection whose peer can't be told, or runs as someone else, is closed
 * at once.
 *
 * Each connection is held to the protocol's limits: a line too long, a
 * flood of messages, or too many refused ones ends it; a refused message
 * otherwise leaves the menus it had. Its menus go when it closes.
 */

import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { peerPid } from "../agents/peer.ts";
import { LIMITS, parseClientMessage, type ShellMessage } from "../shared/app-menus/protocol.ts";
import { LineBuffer } from "../shared/io/lines.ts";
import type { AppMenuStore, MenuOwner } from "./store.ts";

/** Messages a connection may send in one second before it is cut off (an update per keystroke is far fewer). */
export const MAX_RATE = 60;
/** Refused messages a connection may send before it is cut off. */
export const MAX_REFUSED = 8;
/** Bytes waiting for an app that does not read before it is cut off. */
const MAX_OUTBOX = 64 * 1024;
/** Apps connected at once. */
export const MAX_CONNECTIONS = 64;

/** What a Bun socket offers a connection. */
export interface Wire {
  write(data: Uint8Array): number;
  terminate(): void;
}

export class MenuConnection implements MenuOwner {
  private readonly lines = new LineBuffer();
  private outbox: Uint8Array[] = [];
  private queued = 0;
  private refused = 0;
  private recent: number[] = [];
  private closed = false;

  constructor(
    readonly pid: number,
    private readonly wire: Wire,
    private readonly store: AppMenuStore,
    private readonly now: () => number = Date.now,
  ) {}

  receive(chunk: Uint8Array): void {
    if (this.closed) return;
    const lines = this.lines.push(chunk);
    if (this.lines.pending > LIMITS.line) return this.end();
    for (const line of lines) {
      if (this.closed) return;
      if (line.trim()) this.handle(line);
    }
  }

  send(message: ShellMessage): void {
    if (this.closed) return;
    const bytes = new TextEncoder().encode(`${JSON.stringify(message)}\n`);
    this.outbox.push(bytes);
    this.queued += bytes.byteLength;
    if (this.queued > MAX_OUTBOX) return this.end();
    this.drain();
  }

  /** The socket can take more. */
  drain(): void {
    while (!this.closed && this.outbox.length > 0) {
      const next = this.outbox[0] as Uint8Array;
      const written = Math.max(this.wire.write(next), 0);
      this.queued -= Math.min(written, next.byteLength);
      if (written < next.byteLength) {
        this.outbox[0] = next.subarray(written);
        return;
      }
      this.outbox.shift();
    }
  }

  /** The socket closed, from either side: the menus go. */
  closedBySocket(): void {
    this.closed = true;
    this.store.withdraw(this);
  }

  private handle(line: string): void {
    const now = this.now();
    this.recent = [...this.recent.filter((at) => now - at < 1000), now];
    if (this.recent.length > MAX_RATE) return this.end();
    const message = parseClientMessage(line);
    if ("error" in message) {
      if (++this.refused > MAX_REFUSED) return this.end();
      this.send({ type: "error", message: message.error });
      return;
    }
    if (message.type === "front") return this.store.front(this);
    this.store.publish(this, message.menus, message.typing === true);
  }

  private end(): void {
    if (this.closed) return;
    this.closedBySocket();
    this.wire.terminate();
  }
}

export interface ServeOptions {
  path: string | null;
  store: AppMenuStore;
  /** The connecting process from the socket's fd, null if it can't be told or isn't this user's (SO_PEERCRED). */
  peer?: (fd: number) => number | null;
}

/** Listens on `path`; returns the function that stops (and removes the socket). */
export function serveMenus({ path, store, peer = peerPid }: ServeOptions): () => void {
  if (!path) {
    console.error("dashi-shell: no XDG_RUNTIME_DIR; apps can't publish their menus");
    return () => {};
  }
  if (existsSync(path)) unlinkSync(path);
  const connections = new Set<MenuConnection>();
  const server = Bun.listen<{ connection?: MenuConnection }>({
    unix: path,
    socket: {
      open(socket) {
        const fd = (socket as unknown as { fd?: number }).fd;
        const pid = typeof fd === "number" ? peer(fd) : null;
        if (pid === null || connections.size >= MAX_CONNECTIONS) {
          socket.terminate();
          return;
        }
        const connection = new MenuConnection(pid, socket, store);
        connections.add(connection);
        socket.data = { connection };
      },
      data(socket, data) {
        socket.data?.connection?.receive(data);
      },
      drain(socket) {
        socket.data?.connection?.drain();
      },
      close(socket) {
        const connection = socket.data?.connection;
        if (!connection) return;
        connections.delete(connection);
        connection.closedBySocket();
      },
      error(socket) {
        const connection = socket.data?.connection;
        if (!connection) return;
        connections.delete(connection);
        connection.closedBySocket();
      },
    },
  });
  chmodSync(path, 0o600);
  return () => {
    for (const connection of connections) connection.closedBySocket();
    connections.clear();
    server.stop(true);
    if (existsSync(path)) unlinkSync(path);
  };
}
