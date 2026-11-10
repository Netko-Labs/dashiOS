/**
 * The agents' MCP server, `$XDG_RUNTIME_DIR/dashi-mcp.sock`: one session per
 * connection (bin/dashi-mcp bridges an agent's stdio to it). ⌃❖Esc reaches
 * here as a compositor shortcut event; Stop in the menu bar calls `stop`.
 * The same server answers at `$XDG_RUNTIME_DIR/dashi-mcp.d/dashi-mcp.sock`,
 * in a folder a task's sandbox binds whole (sandbox.ts `TASK_SOCKET_DIR`):
 * a socket bound alone stays the old one when the shell restarts, a folder
 * shows the new one, so a run's bridge connects again (docs/actions.md,
 * "Agents from the launcher").
 */

import { join } from "node:path";
import { type BrowserBridge, startBrowserBridge } from "../browser/bridge.ts";
import type { Compositor } from "../compositor.ts";
import type { Arrange, Tile } from "../layout.ts";
import type { Question } from "./confirm.ts";
import { Grants } from "./consent.ts";
import type { ToolResult } from "./context.ts";
import { type Desktop, frontPage, Hands } from "./desktop/index.ts";
import { LockWatch } from "./lock.ts";
import type { AgentStore, AgentUi } from "./presence.ts";
import { type LoginSource, Vault } from "./secrets/index.ts";
import { personRunner } from "./server-person.ts";
import { sharedSecrets } from "./server-shared.ts";
import { listenAgents } from "./server-sockets.ts";
import type { Session } from "./session.ts";
import type { TaskHooks, TaskPolicy } from "./session-types.ts";
import { SiteGrants } from "./sites.ts";
import type { Call } from "./tools/index.ts";

export interface Agents {
  /** The kept answers; System Settings lists and revokes them through this one. */
  readonly grants: Grants;
  /** The sites agents may use without asking; Settings › Agents edits the person's list through this one. */
  readonly sites: SiteGrants;
  /** Cut one agent off (the pill's stop square). */
  stop(id: number): void;
  /** Cut every agent off (⌃❖Esc). */
  stopAll(): void;
  /** The stores and controllers tools reach (the action registry reads settings through them: actions/). */
  readonly desktop: Desktop;
  /**
   * Carry out a tool's call for the person (the launcher, a key, a link:
   * actions/lib/run.ts): the same code an agent's call runs, named as "you",
   * seeing what the person sees. A tool that asks every time asks `confirm`,
   * the person's own sheet. Nothing runs while the screen is locked.
   */
  runAsPerson(call: Call, confirm: (question: Question) => Promise<boolean>): Promise<ToolResult>;
  /** The page in front in Helium, through Dashi's extension (the launcher's context chip); null without one. */
  frontPage(): Promise<{ url: string; title: string } | null>;
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
  /** Runs started from the launcher (agents/handoff/): a connection from one's sandbox gets its policy. */
  tasks?: TaskHooks & { policy(task: string): TaskPolicy | null };
}

export function startAgents({
  compositor,
  ui,
  store,
  tile,
  arrangement = () => null,
  desktop,
  sources = () => [],
  vault = new Vault(),
  tasks,
}: AgentsOptions): Agents {
  const sessions = new Map<number, Session>();
  const publish = () => store.set([...sessions.values()].map((session) => session.info()));
  const lock = new LockWatch(compositor);
  const grants = new Grants();
  const hands = new Hands(compositor);
  const sites = new SiteGrants();
  // Dashi's browser extension joins here through its host (docs/actions.md, "Websites").
  const browser: BrowserBridge = startBrowserBridge();
  const { secrets, mask, close: closeAtspi } = sharedSecrets(compositor, sources, vault);
  const context = { compositor, ui, desktop, hands, mask, grants, lock, publish, tile, arrangement, secrets, browser, sites, ...(tasks ? { tasks } : {}) };
  const runAsPerson = personRunner({ compositor, ui, desktop, hands, mask, secrets, lock, browser, tile, arrangement });

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
    if (!change.removed && !change.revoked) return;
    // Its websites go with it, and with "Use websites".
    if (change.removed || change.revoked?.includes("web")) sites.remove(change.key);
    for (const session of sessions.values()) session.revoke(change.key, change.revoked);
    publish();
  });
  // Locking takes down any sheet that is up; calls fail while it lasts.
  lock.onChange((locked) => {
    if (locked) for (const session of sessions.values()) session.screenLocked();
  });

  const path = socketPath();
  if (!path) console.error("dashi-shell: no XDG_RUNTIME_DIR; agents can't connect");
  const listening = path ? listenAgents(path, { sessions, context, tasks, publish }) : null;

  return {
    grants,
    sites,
    desktop,
    runAsPerson,
    frontPage: () => frontPage(browser.current()),
    stop(id) {
      const session = sessions.get(id);
      if (session) stopSessions([session]);
    },
    stopAll() {
      if (listening) stopSessions([...sessions.values()]);
    },
    close() {
      offShortcuts();
      offGrants();
      lock.close();
      hands.close();
      listening?.close();
      browser.close();
      closeAtspi();
    },
  };
}
