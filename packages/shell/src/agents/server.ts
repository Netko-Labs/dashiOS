/**
 * The agents' MCP server, `$XDG_RUNTIME_DIR/dashi-mcp.sock`: one session per
 * connection (bin/dashi-mcp bridges an agent's stdio to it). ⌃❖Esc reaches
 * here as a compositor shortcut event; Stop in the menu bar calls `stop`.
 */

import { chmodSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Compositor } from "../compositor.ts";
import type { Tile } from "../layout.ts";
import { Atspi } from "./atspi/client.ts";
import { Grants } from "./consent.ts";
import { Hands } from "./desktop/hands.ts";
import type { Desktop } from "./desktop/index.ts";
import { LockWatch } from "./lock.ts";
import { AgentMask } from "./mask.ts";
import { identify, peerPid } from "./peer.ts";
import type { AgentStore, AgentUi } from "./presence.ts";
import { isConfined } from "./sandbox.ts";
import type { SecretsShared } from "./secrets/session-secrets.ts";
import type { LoginSource } from "./secrets/sources.ts";
import { isVaultWindow } from "./secrets/vault-view.ts";
import { Session } from "./session.ts";

export interface Agents {
  /** The kept answers; System Settings lists and revokes them through this one. */
  readonly grants: Grants;
  /** Cut one agent off (the pill's stop square). */
  stop(id: number): void;
  /** Cut every agent off (⌃❖Esc). */
  stopAll(): void;
  close(): void;
}

export function socketPath(): string | null {
  const dir = process.env.XDG_RUNTIME_DIR;
  return dir ? join(dir, "dashi-mcp.sock") : null;
}

export interface AgentsOptions {
  compositor: Compositor;
  ui: AgentUi;
  store: AgentStore;
  /** Snap a window into a tile (arrange.ts). */
  tile(window: number, tile: Tile): Promise<void>;
  /** The stores and controllers tools reach besides windows (desktop/). */
  desktop: Desktop;
  /** The login sources sign-in uses (secrets/passwords.ts); none without. */
  sources?: () => readonly LoginSource[];
}

/** A file's text, or null. */
const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export function startAgents({ compositor, ui, store, tile, desktop, sources = () => [] }: AgentsOptions): Agents {
  const sessions = new Map<number, Session>();
  const publish = () => store.set([...sessions.values()].map((session) => session.info()));
  const lock = new LockWatch(compositor);
  const grants = new Grants();
  const hands = new Hands(compositor);
  // The accessibility bus, joined when a picture first needs it; a failure is tried again next time.
  let atspi: Atspi | null = null;
  const joinAtspi = async () => (atspi ??= await Atspi.connect());
  const secrets: SecretsShared = { sources, atspi: joinAtspi, handedOver: new Set() };
  const mask = new AgentMask({
    request: (method, params) => compositor.request(method, params),
    windows: () => compositor.windows(),
    atspi: joinAtspi,
    handedOver: () => [...secrets.handedOver],
    isVault: isVaultWindow,
  });
  const context = { compositor, ui, desktop, hands, mask, grants, lock, publish, tile, secrets };
  let nextId = 0;

  const stopSessions = (stopping: Session[]) => {
    const names = stopping.map((session) => session.peer.name);
    for (const session of stopping) session.stop("stopped");
    // Their cursor goes, and nothing they held stays down.
    void hands.release();
    if (names.length > 0) ui.stopped(names);
  };

  const offShortcuts = compositor.on((event) => {
    if (event.event === "shortcut" && event.name === "stop-agents") stopSessions([...sessions.values()]);
  });
  // A revoked answer is gone from the connections that hold it too.
  const offGrants = grants.onChange((change) => {
    if (!change.removed) return;
    for (const session of sessions.values()) session.revoke(change.key);
    publish();
  });
  // Locking takes down any sheet that is up; calls fail while it lasts.
  lock.onChange((locked) => {
    if (locked) for (const session of sessions.values()) session.screenLocked();
  });

  const path = socketPath();
  if (!path) {
    console.error("dashi-shell: no XDG_RUNTIME_DIR; agents can't connect");
    return {
      grants,
      stop() {},
      stopAll() {},
      close() {
        offShortcuts();
        offGrants();
        lock.close();
        hands.close();
      },
    };
  }
  if (existsSync(path)) unlinkSync(path);
  const server = Bun.listen<{ session?: Session }>({
    unix: path,
    socket: {
      open(socket) {
        // Bun sockets carry their fd; SO_PEERCRED says who is on the other end.
        const fd = (socket as unknown as { fd?: number }).fd;
        const pid = typeof fd === "number" ? peerPid(fd) : null;
        if (pid === null) {
          socket.terminate();
          return;
        }
        const peer = identify(pid);
        const confined = isConfined(readText, pid, peer.remote);
        const session = new Session(
          ++nextId,
          peer,
          socket,
          context,
          (gone) => {
            sessions.delete(gone.id);
            publish();
          },
          confined,
        );
        socket.data = { session };
        sessions.set(session.id, session);
        publish();
      },
      data(socket, data) {
        socket.data?.session?.receive(data);
      },
      drain(socket) {
        socket.data?.session?.drain();
      },
      close(socket) {
        socket.data?.session?.stop("disconnected");
      },
      error(socket) {
        socket.data?.session?.stop("disconnected");
      },
    },
  });
  chmodSync(path, 0o600);

  return {
    grants,
    stop(id) {
      const session = sessions.get(id);
      if (session) stopSessions([session]);
    },
    stopAll() {
      stopSessions([...sessions.values()]);
    },
    close() {
      offShortcuts();
      offGrants();
      lock.close();
      hands.close();
      for (const session of sessions.values()) session.stop("disconnected");
      server.stop(true);
      atspi?.close();
      if (existsSync(path)) unlinkSync(path);
    },
  };
}
