/**
 * An app's own menus in Dashi's menu bar (src/app-menus/protocol.ts): one
 * connection per process to `$XDG_RUNTIME_DIR/dashi-menus.sock`, the latest
 * menus sent whenever they change, and the shell's "select" handed to the
 * app. Outside Dashi (no socket) nothing is sent and nothing is chosen. When
 * the shell restarts, the app connects again and sends its menus again.
 *
 *   useAppMenus(
 *     [{ id: "file", items: [{ id: "new", label: "New Note", shortcut: "❖N" }, { type: "separator" }, { id: "delete", label: "Delete", enabled: hasSelection }] }],
 *     (id) => { if (id === "new") addNote(); },
 *   );
 *
 * A shortcut is a real key in Dashi's own apps: the shell chooses the focused
 * app's enabled row that shows a pressed ❖ chord (app-menus/shortcut.ts).
 */

import { existsSync } from "node:fs";
import { useEffect, useRef } from "react";
import { type MenuSpec, menusSocketPath, parseMenus, parseShellMessage } from "../../src/app-menus/protocol.ts";
import { LineBuffer } from "../../src/lines.ts";

export type { MenuItemSpec, MenuSpec } from "../../src/app-menus/protocol.ts";

/** What the client needs of a socket. */
export interface MenuSocket {
  write(data: Uint8Array): number;
  end(): void;
}

export interface MenuSocketHandlers {
  open(socket: MenuSocket): void;
  data(chunk: Uint8Array): void;
  /** The socket can take more. */
  drain(): void;
  close(): void;
}

export interface ClientOptions {
  path: string | null;
  /** Opens a connection to `path` (Bun.connect); throws or fails through `close` when it can't. */
  connect?(path: string, handlers: MenuSocketHandlers): void;
  exists?(path: string): boolean;
  /** Runs `fn` later (to connect again); returns the way to cancel it. */
  later?(fn: () => void, ms: number): () => void;
}

/** How long after the shell went the client looks for it again, doubling up to the last. */
const RETRY_MS = [1000, 2000, 4000, 8000, 15000] as const;

function bunConnect(path: string, handlers: MenuSocketHandlers): void {
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

export class MenusClient {
  private socket: MenuSocket | null = null;
  private connecting = false;
  /** The message to send: the latest menus, already written out. */
  private line: string | null = null;
  /** Bytes the socket did not take yet. */
  private unsent = new Uint8Array();
  private handler: (id: string) => void = () => {};
  private retries = 0;
  private cancelRetry: (() => void) | null = null;
  private closed = false;
  private readonly connect: NonNullable<ClientOptions["connect"]>;
  private readonly exists: NonNullable<ClientOptions["exists"]>;
  private readonly later: NonNullable<ClientOptions["later"]>;

  constructor(private readonly options: ClientOptions) {
    this.connect = options.connect ?? bunConnect;
    this.exists = options.exists ?? existsSync;
    this.later = options.later ?? unrefTimeout;
  }

  /** Whether the shell is listening (a Dashi session). */
  get available(): boolean {
    return this.options.path !== null && this.exists(this.options.path);
  }

  /** The app's menus now; an empty list takes them down. Invalid menus are refused here, with the reason on stderr. */
  publish(menus: readonly MenuSpec[]): void {
    const parsed = parseMenus(menus);
    if ("error" in parsed) {
      console.error(`dashi menus: not sent: ${parsed.error}`);
      return;
    }
    if (menus.length === 0 && !this.socket) {
      // Nothing was shown, so nothing needs taking down.
      this.line = null;
      return;
    }
    this.line = `${JSON.stringify({ type: "menus", menus })}\n`;
    if (this.socket) this.write(this.line);
    else this.start();
  }

  /** Who hears a chosen item (the latest one set). */
  onSelect(handler: (id: string) => void): void {
    this.handler = handler;
  }

  close(): void {
    this.closed = true;
    this.cancelRetry?.();
    this.socket?.end();
    this.socket = null;
  }

  private start(): void {
    if (this.closed || this.connecting || this.socket || this.line === null || !this.available) return;
    this.connecting = true;
    const lines = new LineBuffer();
    let opened = false;
    let done = false;
    try {
      this.connect(this.options.path as string, {
        open: (socket) => {
          opened = true;
          this.connecting = false;
          this.retries = 0;
          if (this.closed) return socket.end();
          this.socket = socket;
          if (this.line !== null) this.write(this.line);
        },
        drain: () => this.flush(),
        data: (chunk) => {
          for (const line of lines.push(chunk)) {
            const message = parseShellMessage(line);
            if (message?.type === "select") this.handler(message.id);
            else if (message?.type === "error") console.error(`dashi menus: the shell refused the menus: ${message.message}`);
          }
        },
        close: () => {
          if (done) return;
          done = true;
          this.connecting = false;
          this.socket = null;
          this.unsent = new Uint8Array();
          // Only a shell that was there and went is looked for again.
          if (opened || this.retries > 0) this.retry();
        },
      });
    } catch {
      this.connecting = false;
    }
  }

  private retry(): void {
    if (this.closed) return;
    const delay = RETRY_MS[Math.min(this.retries, RETRY_MS.length - 1)] ?? 15000;
    this.retries++;
    this.cancelRetry = this.later(() => {
      this.cancelRetry = null;
      if (this.available) this.start();
      else this.retry();
    }, delay);
  }

  private write(text: string): void {
    // Whatever did not fit last time goes first, so lines stay whole.
    const bytes = new TextEncoder().encode(text);
    const joined = new Uint8Array(this.unsent.byteLength + bytes.byteLength);
    joined.set(this.unsent);
    joined.set(bytes, this.unsent.byteLength);
    this.unsent = joined;
    this.flush();
  }

  private flush(): void {
    if (!this.socket || this.unsent.byteLength === 0) return;
    const written = this.socket.write(this.unsent);
    this.unsent = this.unsent.subarray(Math.max(written, 0));
  }
}

/** The ids of the rows that can be chosen now. An app checks a chosen id against this: the shell only sends enabled ones, but an id is still untrusted text, and the menus may have changed since. */
export function enabledIds(menus: readonly MenuSpec[]): ReadonlySet<string> {
  return new Set(menus.flatMap((menu) => menu.items.flatMap((row) => (row.type !== "separator" && row.enabled !== false ? [row.id] : []))));
}

let shared: MenusClient | null = null;

/** The process's one connection. */
export function menusClient(): MenusClient {
  shared ??= new MenusClient({ path: menusSocketPath() });
  return shared;
}

/**
 * Publishes `menus` while the component is mounted (again whenever they
 * change) and calls `onSelect` with the id of an item chosen in the menu
 * bar. Does nothing outside Dashi.
 */
export function useAppMenus(menus: readonly MenuSpec[], onSelect: (id: string) => void, client: MenusClient = menusClient()): void {
  const latest = useRef(onSelect);
  latest.current = onSelect;
  const key = JSON.stringify(menus);
  useEffect(() => {
    client.onSelect((id) => latest.current(id));
  }, [client]);
  useEffect(() => {
    client.publish(JSON.parse(key) as MenuSpec[]);
  }, [client, key]);
  useEffect(() => () => client.publish([]), [client]);
}
