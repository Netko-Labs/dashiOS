/**
 * The agents' MCP server, `$XDG_RUNTIME_DIR/dashi-mcp.sock`: one session per
 * connection (bin/dashi-mcp bridges an agent's stdio to it). ⌃❖Esc reaches
 * here as a compositor shortcut event; Stop in the menu bar calls `stop`.
 */

import { chmodSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Compositor } from "../compositor.ts";
import type { Arrange, Tile } from "../layout.ts";
import { Atspi } from "./atspi/client.ts";
import type { Question } from "./confirm.ts";
import { Grants } from "./consent.ts";
import { type ToolResult, toolError } from "./context.ts";
import { Hands } from "./desktop/hands.ts";
import type { Desktop } from "./desktop/index.ts";
import { LOCKED, LockWatch } from "./lock.ts";
import { AgentMask } from "./mask.ts";
import { identify, peerPid } from "./peer.ts";
import type { AgentStore, AgentUi } from "./presence.ts";
import { runCall } from "./run.ts";
import { isConfined } from "./sandbox.ts";
import { type SecretsShared, SessionSecrets } from "./secrets/session-secrets.ts";
import type { LoginSource } from "./secrets/sources.ts";
import { Vault } from "./secrets/vault.ts";
import { isVaultWindow } from "./secrets/vault-view.ts";
import { Session } from "./session.ts";
import type { Call } from "./tools/index.ts";

export interface Agents {
  /** The kept answers; System Settings lists and revokes them through this one. */
  readonly grants: Grants;
  /** Cut one agent off (the pill's stop square). */
  stop(id: number): void;
  /** Cut every agent off (⌃❖Esc). */
  stopAll(): void;
  /** The stores and controllers tools reach (the action registry reads settings through them: actions/). */
  readonly desktop: Desktop;
  /**
   * Carry out a tool's call for the person (the launcher, a key, a link:
   * actions/run.ts): the same code an agent's call runs, named as "you",
   * seeing what the person sees. A tool that asks every time asks `confirm`,
   * the person's own sheet. Nothing runs while the screen is locked.
   */
  runAsPerson(call: Call, confirm: (question: Question) => Promise<boolean>): Promise<ToolResult>;
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
  /** Tile, fill, center, or give a window its own frame back (arrange.ts). */
  tile(window: number, to: Arrange): Promise<void>;
  /** How the shell arranged a window, or null at its own frame (arrange.ts). */
  arrangement?(window: number): Tile | null;
  /** The stores and controllers tools reach besides windows (desktop/). */
  desktop: Desktop;
  /** The login sources sign-in uses (secrets/passwords.ts); none without. */
  sources?: () => readonly LoginSource[];
  /** Dashi's vault, for cards and payments. */
  vault?: Pick<Vault, "cards" | "pay">;
}

/** A file's text, or null. */
const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export function startAgents({
  compositor,
  ui,
  store,
  tile,
  arrangement = () => null,
  desktop,
  sources = () => [],
  vault = new Vault(),
}: AgentsOptions): Agents {
  const sessions = new Map<number, Session>();
  const publish = () => store.set([...sessions.values()].map((session) => session.info()));
  const lock = new LockWatch(compositor);
  const grants = new Grants();
  const hands = new Hands(compositor);
  // The accessibility bus, joined when a picture first needs it; a failure is tried again next time.
  let atspi: Atspi | null = null;
  const joinAtspi = async () => (atspi ??= await Atspi.connect());
  const secrets: SecretsShared = { sources, atspi: joinAtspi, handedOver: new Set(), filled: new Map(), vault };
  const mask = new AgentMask({
    request: (method, params) => compositor.request(method, params),
    windows: () => compositor.windows(),
    atspi: joinAtspi,
    handedOver: () => [...secrets.handedOver],
    filled: () =>
      [...secrets.filled].flatMap(([window, fields]) =>
        fields
          .filter((f) => f.until > Date.now())
          .map((field) => ({
            window,
            rect: field.rect,
            again: field.again,
            forget: () =>
              secrets.filled.set(
                window,
                (secrets.filled.get(window) ?? []).filter((f) => f !== field),
              ),
          })),
      ),
    isVault: isVaultWindow,
  });
  secrets.touched = (window) => mask.prompts.touched(window);
  const context = { compositor, ui, desktop, hands, mask, grants, lock, publish, tile, arrangement, secrets };
  let nextId = 0;
  // The person's calls: never confined (no sign-in for them), named "You" where a sheet would name an agent.
  const personSecrets = new SessionSecrets(secrets, ui, false);
  const you = () => ({ name: "You", detail: "", claims: null, remote: false });
  const runAsPerson = async (call: Call, confirm: (question: Question) => Promise<boolean>): Promise<ToolResult> => {
    if (lock.isLocked) return toolError(LOCKED);
    const signal = new AbortController().signal;
    return runCall(call, {
      compositor,
      ui,
      desktop,
      hands,
      mask,
      secrets: personSecrets.run(0, you, signal),
      agent: "You",
      status: () => {},
      tile,
      arrangement,
      mayName: () => true,
      confirm,
      signal,
    });
  };

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
      desktop,
      runAsPerson,
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
    desktop,
    runAsPerson,
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
