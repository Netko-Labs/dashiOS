/**
 * The calls one connection runs: each as its agent (acting.ts), under the
 * red dot it shows, noted in Work alone's record, and given up on when the
 * agent cancels it (`notifications/cancelled`) or is cut off.
 */

import { type Actor, actingAs } from "../../../acting.ts";
import { NOT_ALONE, noteCall } from "../../alone/index.ts";
import { type ToolResult, toolError } from "../../context.ts";
import { LOCKED_WHILE_RUNNING } from "../../lock.ts";
import { watchingOf } from "../../mark.ts";
import type { Who } from "../../presence.ts";
import type { SessionSecrets } from "../../secrets/index.ts";
import { type Call, locksScreen } from "../../tools/index.ts";
import type * as mcp from "../mcp.ts";
import { runCall } from "../run/run.ts";
import type { SessionBrowser } from "./session-browser.ts";
import type { Scopes } from "./session-scopes.ts";
import type { SessionContext, SessionTask } from "./session-types.ts";
import type { SessionWatch } from "./session-watch.ts";

/** What a call needs of the connection it runs on. */
export interface CallHost {
  readonly id: number;
  /** The process's name, as sheets show it. */
  readonly agent: string;
  ctx: SessionContext;
  task: SessionTask | null;
  actor(): Actor;
  who(): Who;
  secrets: SessionSecrets;
  scopes: Scopes;
  browser: SessionBrowser;
  watch: SessionWatch;
  setStatus(text: string): void;
  /** A call that ended without an answer to send (cancelled). */
  ended(tool: string, outcome: string): void;
  reply(id: mcp.Id, tool: string, result: ToolResult): void;
}

export class SessionCalls {
  /** Calls running now, each to be given up on when the agent cancels it. */
  private readonly inFlight = new Map<mcp.Id, AbortController>();

  constructor(private readonly host: CallHost) {}

  /** Give up on the running call `id`; false when it isn't running. */
  cancel(id: mcp.Id): boolean {
    const running = this.inFlight.get(id);
    running?.abort();
    return running !== undefined;
  }

  /** The agent is cut off: what it was doing stops (nothing more is typed). */
  stop(): void {
    for (const running of this.inFlight.values()) running.abort();
  }

  async run(id: mcp.Id, call: Call, free = false): Promise<void> {
    const host = this.host;
    const { ctx, task } = host;
    const sites = new Set<string>();
    const controller = new AbortController();
    this.inFlight.set(id, controller);
    const { signal } = controller;
    let result: ToolResult;
    const undo = task ? (ctx.tasks?.before(task.id, call) ?? null) : null;
    const watch = watchingOf(call.name);
    host.watch.start(watch);
    try {
      // A sign-in runs alone; a hand-over holds the rest until Done (secrets/session-secrets.ts).
      // What it changes is this agent's (Settings › Recently changed: acting.ts).
      result = await host.secrets.around(call, () =>
        actingAs(host.actor(), () =>
          runCall(call, {
            compositor: ctx.compositor,
            ui: ctx.ui,
            desktop: ctx.desktop,
            hands: ctx.hands,
            mask: ctx.mask,
            secrets: host.secrets.run(host.id, () => host.who(), signal),
            agent: host.agent,
            status: (text) => host.setStatus(text),
            tile: ctx.tile,
            arrangement: ctx.arrangement,
            mayName: () => host.scopes.holds("see"),
            browser: host.browser.run((site) => sites.add(site)),
            alone: () => ctx.alone?.status() ?? NOT_ALONE,
            ...host.scopes.asks(signal),
            signal,
          }),
        ),
      );
    } catch (error) {
      result = toolError(`${call.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.inFlight.delete(id);
      host.watch.end(watch);
    }
    // Work alone's record: who called what, on which sites, and whether it ran without asking.
    noteCall(ctx.alone, { agent: host.actor().agent, tool: call.name, sites, free }, signal.aborted, result.isError === true);
    if (signal.aborted) return host.ended(call.name, "cancelled");
    // Locked meanwhile: whatever it saw or did stays between it and the lock screen.
    if (ctx.lock.isLocked && !locksScreen(call.name)) result = toolError(LOCKED_WHILE_RUNNING);
    if (task) ctx.tasks?.after(task.id, undo, result.isError !== true);
    host.reply(id, call.name, result);
  }
}
