/**
 * The shell's end of the applets channel (protocol.ts): a socket only this
 * user can reach (mode 0600 in the runtime directory). As with the app menus
 * (app-menus/server.ts), who connected is the kernel's word (SO_PEERCRED),
 * and a connection whose peer can't be told is closed at once.
 *
 * Each connection's applets become menu bar extras (extras/) and go when it
 * closes. A line too long, a flood of messages, or too many refused ones
 * ends the connection; a refused message otherwise leaves its applets as
 * they were.
 */

import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { peerPid } from "../agents/peer.ts";
import type { ExtraActions, ExtraMenuRow, ExtrasStore, MenuBarExtra } from "../extras/index.ts";
import { LineBuffer } from "../lines.ts";
import { APPLET_LIMITS, type Applet, type AppletShellMessage, parseAppletMessage } from "./protocol.ts";

/** Messages a connection may send in one second before it is cut off (a clock ticking once a second is far fewer). */
export const MAX_RATE = 30;
/** Refused messages a connection may send before it is cut off. */
export const MAX_REFUSED = 8;
/** Bytes waiting for an applet that does not read before it is cut off. */
const MAX_OUTBOX = 64 * 1024;
/** Connections at once. */
export const MAX_CONNECTIONS = 32;

/** What a Bun socket offers a connection. */
export interface Wire {
  write(data: Uint8Array): number;
  terminate(): void;
}

/** What the bar draws for an applet. */
export function appletExtra(key: string, applet: Applet): MenuBarExtra {
  const icon =
    applet.glyph !== undefined
      ? { kind: "glyph" as const, markup: applet.glyph }
      : applet.icon !== undefined
        ? { kind: "image" as const, path: applet.icon }
        : null;
  return {
    key,
    source: "applet",
    title: applet.title,
    icon,
    ...(applet.label === undefined ? {} : { label: applet.label }),
    tooltip: applet.tooltip ?? applet.title,
    attention: applet.attention,
    menuOnClick: applet.click === "menu",
    hasMenu: applet.menu.length > 0,
  };
}

/** An applet's menu rows as the bar's menus take them. */
export function appletRows(applet: Applet): ExtraMenuRow[] {
  return applet.menu.map((row) =>
    row.kind === "separator"
      ? row
      : { kind: "item", id: row.id, label: row.label, enabled: row.enabled, ...(row.checked === undefined ? {} : { checked: row.checked }) },
  );
}

let serial = 0;

export class AppletConnection implements ExtraActions {
  private readonly lines = new LineBuffer();
  private readonly applets = new Map<string, Applet>();
  /** Keys in the extras store start with this; the applet's id follows. */
  private readonly prefix = `applet:${++serial}/`;
  private outbox: Uint8Array[] = [];
  private queued = 0;
  private refused = 0;
  private recent: number[] = [];
  private closed = false;

  constructor(
    readonly pid: number,
    private readonly wire: Wire,
    private readonly extras: ExtrasStore,
    private readonly now: () => number = Date.now,
    private readonly parse: typeof parseAppletMessage = parseAppletMessage,
  ) {}

  receive(chunk: Uint8Array): void {
    if (this.closed) return;
    const lines = this.lines.push(chunk);
    if (this.lines.pending > APPLET_LIMITS.line) return this.end();
    for (const line of lines) {
      if (this.closed) return;
      if (line.trim()) this.handle(line);
    }
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

  /** The socket closed, from either side: the applets go. */
  closedBySocket(): void {
    this.closed = true;
    this.extras.dropWhere((extra) => extra.key.startsWith(this.prefix));
    this.applets.clear();
  }

  activate(key: string, x: number, y: number): void {
    const applet = this.appletOf(key);
    if (applet) this.send({ type: "activate", id: applet.id, x: Math.round(x), y: Math.round(y) });
  }

  /** A middle click is a primary one for an applet. */
  secondaryActivate(key: string, x: number, y: number): void {
    this.activate(key, x, y);
  }

  menu(key: string): Promise<readonly ExtraMenuRow[]> {
    const applet = this.appletOf(key);
    return Promise.resolve(applet ? appletRows(applet) : []);
  }

  choose(key: string, item: string): void {
    const applet = this.appletOf(key);
    const row = applet?.menu.find((each) => each.kind === "item" && each.id === item);
    if (applet && row?.kind === "item" && row.enabled) this.send({ type: "select", id: applet.id, item });
  }

  private appletOf(key: string): Applet | undefined {
    return key.startsWith(this.prefix) ? this.applets.get(key.slice(this.prefix.length)) : undefined;
  }

  private send(message: AppletShellMessage): void {
    if (this.closed) return;
    const bytes = new TextEncoder().encode(`${JSON.stringify(message)}\n`);
    this.outbox.push(bytes);
    this.queued += bytes.byteLength;
    if (this.queued > MAX_OUTBOX) return this.end();
    this.drain();
  }

  private handle(line: string): void {
    const now = this.now();
    this.recent = [...this.recent.filter((at) => now - at < 1000), now];
    if (this.recent.length > MAX_RATE) return this.end();
    const message = this.parse(line);
    if ("error" in message) return this.refuse(message.error);
    if (message.type === "remove") {
      if (this.applets.delete(message.id)) this.extras.drop(this.prefix + message.id);
      return;
    }
    const { applet } = message;
    if (!this.applets.has(applet.id) && this.applets.size >= APPLET_LIMITS.perConnection) {
      return this.refuse(`more than ${APPLET_LIMITS.perConnection} applets on one connection`);
    }
    this.applets.set(applet.id, applet);
    this.extras.put(appletExtra(this.prefix + applet.id, applet), this);
  }

  private refuse(error: string): void {
    if (++this.refused > MAX_REFUSED) return this.end();
    this.send({ type: "error", message: error });
  }

  private end(): void {
    if (this.closed) return;
    this.closedBySocket();
    this.wire.terminate();
  }
}

export interface ServeAppletsOptions {
  path: string | null;
  extras: ExtrasStore;
  /** The connecting process from the socket's fd, null if it can't be told or isn't this user's (SO_PEERCRED). */
  peer?: (fd: number) => number | null;
}

/** Listens on `path`; returns the function that stops (and removes the socket). */
export function serveApplets({ path, extras, peer = peerPid }: ServeAppletsOptions): () => void {
  if (!path) {
    console.error("dashi-shell: no XDG_RUNTIME_DIR; applets can't reach the menu bar");
    return () => {};
  }
  if (existsSync(path)) unlinkSync(path);
  const connections = new Set<AppletConnection>();
  const gone = (connection: AppletConnection | undefined): void => {
    if (!connection) return;
    connections.delete(connection);
    connection.closedBySocket();
  };
  const server = Bun.listen<{ connection?: AppletConnection }>({
    unix: path,
    socket: {
      open(socket) {
        const fd = (socket as unknown as { fd?: number }).fd;
        const pid = typeof fd === "number" ? peer(fd) : null;
        if (pid === null || connections.size >= MAX_CONNECTIONS) {
          socket.terminate();
          return;
        }
        const connection = new AppletConnection(pid, socket, extras);
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
        gone(socket.data?.connection);
      },
      error(socket) {
        gone(socket.data?.connection);
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
