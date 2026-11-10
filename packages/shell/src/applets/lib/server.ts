/**
 * The shell's end of the applets channel (protocol.ts): sockets only this
 * user can reach (mode 0600 in the runtime directory). As with the app menus
 * (app-menus/server.ts), who connected is the kernel's word (SO_PEERCRED),
 * and a connection whose peer can't be told is closed at once.
 *
 * `$XDG_RUNTIME_DIR/dashi-applets.sock` is everyone's: any program of this
 * user may show an applet there, as in version 1. Each installed applet
 * runs in the sandbox with a socket of its own
 * (`$XDG_RUNTIME_DIR/dashi-applets/<id>.sock`, sandbox.ts), so the shell
 * knows which installed applet a connection is, and it must say hello as
 * what it was installed as.
 */

import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "@dashi/applet";
import { peerPid, socketFd } from "../../agents/index.ts";
import type { ExtrasStore } from "../../extras/index.ts";
import { AppletConnection } from "./connection.ts";
import type { AppletContext } from "./connection-context.ts";

/** Connections at once, on each socket. */
export const MAX_CONNECTIONS = 32;

/** Where an installed applet's own socket is. */
export function appletSocketDir(runtime: string): string {
  return join(runtime, "dashi-applets");
}

export interface ServeAppletsOptions extends Omit<AppletContext, "installed"> {
  path: string | null;
  extras: ExtrasStore;
  /** The installed applet whose socket this is; absent for everyone's. */
  installed?: Manifest;
  /** The connecting process from the socket's fd, null if it can't be told or isn't this user's (SO_PEERCRED). */
  peer?: (fd: number) => number | null;
  /** At most this many connections (an installed applet's socket takes one). */
  maxConnections?: number;
}

/** Listens on `path`; returns the function that stops (and removes the socket). */
export function serveApplets({ path, peer = peerPid, maxConnections = MAX_CONNECTIONS, ...context }: ServeAppletsOptions): () => void {
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
        const fd = socketFd(socket);
        const pid = fd !== null ? peer(fd) : null;
        if (pid === null || connections.size >= maxConnections) {
          socket.terminate();
          return;
        }
        const connection = new AppletConnection(pid, socket, context);
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

/** The folder for installed applets' sockets, only this user's. */
export function ensureSocketDir(runtime: string): string {
  const dir = appletSocketDir(runtime);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}
