/**
 * One agent's connection: MCP requests and replies, and the consent each
 * tool call waits on. A call needing a scope the person hasn't decided on
 * waits while the sheet asks; "Don't Allow", or no answer in two minutes,
 * refuses it, and the agent is told so it can adapt. A tool that can lose
 * the person's work asks again on every call (`confirm`), however the scope
 * was answered.
 */

import { isRecord } from "@dashi/shape";
import { type Actor, actingAs } from "../acting.ts";
import { logActivity, type Scope } from "./consent.ts";
import { type ToolResult, toolError } from "./context.ts";
import { LOCKED_WHILE_RUNNING } from "./lock.ts";
import { connectionHarness, watchingOf } from "./mark.ts";
import * as mcp from "./mcp.ts";
import { grantKey, type Peer } from "./peer.ts";
import type { AgentInfo, Who } from "./presence.ts";
import { runCall } from "./run.ts";
import { SessionSecrets } from "./secrets/index.ts";
import { SessionBrowser } from "./session-browser.ts";
import { type ScopeHost, Scopes } from "./session-scopes.ts";
import type { Connection, SessionContext, SessionTask } from "./session-types.ts";
import { SETTLE_MS, SessionWatch } from "./session-watch.ts";
import { Wire } from "./session-wire.ts";
import { SiteConsent } from "./sites.ts";
import { type Call, catalog, INSTRUCTIONS, locksScreen, parseCall } from "./tools/index.ts";

export type { Connection, SessionContext, SessionTask, TaskHooks, TaskPolicy } from "./session-types.ts";

export class Session {
  private claims: string | null = null;
  /** What this connection may do, and the calls waiting on the person's answer. */
  private readonly scopes: Scopes;
  private status = "Connected";
  private statusSerial = 0;
  private readonly wire: Wire;
  private closed = false;
  private readonly secrets: SessionSecrets;
  /** Calls running now, each to be given up on when the agent cancels it (`notifications/cancelled`). */
  private readonly inFlight = new Map<mcp.Id, AbortController>();
  /** The websites this connection may use, asked one by one (sites.ts). */
  private readonly sites: SiteConsent;
  private readonly browser: SessionBrowser;
  /** When it connected. */
  private readonly since = Date.now();
  private readonly watch: SessionWatch;

  constructor(
    readonly id: number,
    readonly peer: Peer,
    private readonly connection: Connection,
    private readonly ctx: SessionContext,
    private readonly onGone: (session: Session) => void,
    /** In Dashi's agent sandbox, or on another machine (sandbox.ts): only then may it sign in. */
    confined = false,
    /** A run started from the launcher: its card's grants, for this connection only, and nothing kept. */
    private readonly task: SessionTask | null = null,
  ) {
    const granted: Set<Scope> = peer.remote ? new Set() : task ? new Set(task.policy.granted) : ctx.grants.get(peer.key);
    this.wire = new Wire(
      connection,
      () => this.closed,
      (line) => this.handle(line),
      () => this.stop("disconnected"),
    );
    this.scopes = new Scopes(granted, ctx, this.scopeHost(), task);
    this.secrets = new SessionSecrets(ctx.secrets, ctx.ui, confined);
    this.sites = new SiteConsent(
      ctx.sites,
      () => grantKey(this.peer, this.claims),
      (site) => this.scopes.askSite(site),
      // A launcher run's sites hold for the whole task, through its follow-ups' connections.
      task?.policy.sites,
    );
    this.browser = new SessionBrowser(ctx.browser, this.sites);
    this.watch = new SessionWatch(
      () => ctx.publish(),
      () => this.closed,
    );
  }

  info(): AgentInfo {
    return {
      id: this.id,
      name: this.peer.name,
      key: grantKey(this.peer, this.claims),
      status: this.status,
      scopes: [...this.scopes.granted],
      ...(this.task ? { task: this.task.id } : {}),
      detail: this.peer.detail,
      claims: this.claims,
      remote: this.peer.remote,
      harness: connectionHarness(this.peer.name, this.claims),
      since: this.since,
      waiting: this.scopes.busy,
      ...this.watch.now(),
    };
  }

  /** Who this agent is in what it changes: the name it shows with (a remote one's claimed name), and its grants' key. */
  private actor(): Actor {
    const name = this.peer.remote ? (this.claims ?? "") : this.peer.name;
    return { agent: name.replace(/\p{Cc}/gu, "").slice(0, 32) || "Agent", key: grantKey(this.peer, this.claims) };
  }

  /** Settings revoked what this agent was allowed for good (with `scopes`, only those): it is asked again. */
  revoke(key: string, scopes?: readonly Scope[]): void {
    if (grantKey(this.peer, this.claims) === key) this.scopes.revoke(scopes);
  }

  receive(chunk: Uint8Array): void {
    this.wire.receive(chunk);
  }

  /** The socket can take more: flush what waited. */
  drain(): void {
    this.wire.drain();
  }

  private send(message: unknown): void {
    this.wire.send(message);
  }

  private handle(line: string): void {
    if (this.closed) return;
    const incoming = mcp.parse(line);
    if (incoming.kind === "invalid") this.send(mcp.error(incoming.id, incoming.code, incoming.message));
    const cancelled = mcp.cancelledRequest(incoming);
    if (cancelled !== null) return this.cancel(cancelled);
    if (incoming.kind !== "request") return;
    const { id, method, params } = incoming;
    switch (method) {
      case "initialize": {
        const info = params.clientInfo;
        const name = isRecord(info) && typeof info.name === "string" ? info.name : null;
        // Control characters out, and short: it is shown on the sheet.
        this.claims = name ? name.replace(/\p{Cc}/gu, "").slice(0, 64) : null;
        // An agent over SSH is known by its name; its stored grants show up now. A launcher run has its card's only.
        if (!this.task) this.scopes.loadKept();
        this.send(
          mcp.result(id, {
            protocolVersion: mcp.negotiate(params.protocolVersion),
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "dashi", title: "Dashi", version: "0.1.0" },
            instructions: INSTRUCTIONS,
          }),
        );
        this.ctx.publish();
        return;
      }
      case "ping":
        return this.send(mcp.result(id, {}));
      case "tools/list":
        return this.send(mcp.result(id, { tools: catalog() }));
      case "tools/call": {
        const call = parseCall(params);
        if ("unknown" in call) return this.send(mcp.error(id, mcp.INVALID_PARAMS, `Unknown tool: ${call.unknown}`));
        if ("arguments" in call) return this.reply(id, String(params.name), toolError(call.arguments));
        return this.scopes.call(id, call);
      }
      default:
        this.send(mcp.error(id, mcp.METHOD_NOT_FOUND, "Method not found"));
    }
  }

  /** The screen locked: a sheet nobody can reach comes down. */
  screenLocked(): void {
    // Its answer is "Don't Allow", but ask() sees the lock and fails the
    // waiting calls without remembering a refusal.
    if (!this.closed && this.scopes.busy) this.ctx.ui.dismiss(this.id);
  }

  private get who(): Who {
    return { name: this.peer.name, detail: this.peer.detail, claims: this.claims, remote: this.peer.remote };
  }

  /**
   * The agent gave up on request `id` (its client timed out): a call still
   * waiting for its scope is dropped, one running is aborted, so its sheet
   * comes down and nothing it would still have typed is typed. No reply is sent.
   */
  private cancel(id: mcp.Id): void {
    const running = this.inFlight.get(id);
    if (running) {
      running.abort();
      return;
    }
    if (this.scopes.drop(id)) this.log(null, "cancelled");
  }

  private async run(id: mcp.Id, call: Call): Promise<void> {
    const controller = new AbortController();
    this.inFlight.set(id, controller);
    const { signal } = controller;
    let result: ToolResult;
    const task = this.task;
    const undo = task ? (this.ctx.tasks?.before(task.id, call) ?? null) : null;
    const watch = watchingOf(call.name);
    this.watch.start(watch);
    try {
      // A sign-in runs alone; a hand-over holds the rest until Done (secrets/session-secrets.ts).
      // What it changes is this agent's (Settings › Recently changed: acting.ts).
      result = await this.secrets.around(call, () =>
        actingAs(this.actor(), () =>
          runCall(call, {
            compositor: this.ctx.compositor,
            ui: this.ctx.ui,
            desktop: this.ctx.desktop,
            hands: this.ctx.hands,
            mask: this.ctx.mask,
            secrets: this.secrets.run(this.id, () => this.who, signal),
            agent: this.peer.name.replace(/\p{Cc}/gu, "").slice(0, 32) || "Agent",
            status: (text) => this.setStatus(text),
            tile: this.ctx.tile,
            arrangement: this.ctx.arrangement,
            mayName: () => this.scopes.granted.has("see"),
            browser: this.browser.run(),
            confirm: (question) => this.scopes.confirm(question, signal),
            signal,
          }),
        ),
      );
    } catch (error) {
      result = toolError(`${call.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.inFlight.delete(id);
      this.watch.end(watch);
    }
    if (signal.aborted) {
      this.log(call.name, "cancelled");
      this.settle();
      return;
    }
    // Locked meanwhile: whatever it saw or did stays between it and the lock screen.
    if (this.ctx.lock.isLocked && !locksScreen(call.name)) result = toolError(LOCKED_WHILE_RUNNING);
    if (task) this.ctx.tasks?.after(task.id, undo, result.isError !== true);
    this.reply(id, call.name, result);
  }

  /** What the scopes call on this connection. */
  private scopeHost(): ScopeHost {
    return {
      id: this.id,
      who: () => this.who,
      grantKey: () => grantKey(this.peer, this.claims),
      closed: () => this.closed,
      setStatus: (text) => this.setStatus(text),
      resetStatus: () => {
        this.status = "Connected";
      },
      run: (id, call) => void this.run(id, call),
      reply: (id, tool, result) => this.reply(id, tool, result),
    };
  }

  private reply(id: mcp.Id, tool: string, result: ToolResult): void {
    if (this.closed) return;
    this.log(tool, result.isError ? "error" : "ok");
    this.send(mcp.result(id, result));
    this.settle();
  }

  private setStatus(text: string): void {
    this.status = text;
    this.statusSerial++;
    this.ctx.publish();
  }

  /** An action finished: its words stay a moment, then the pill says "Idle". */
  private settle(): void {
    const serial = this.statusSerial;
    setTimeout(() => {
      if (this.closed || this.statusSerial !== serial || this.scopes.asking) return;
      this.status = "Idle";
      this.ctx.publish();
    }, SETTLE_MS);
  }

  private log(tool: string | null, outcome: string): void {
    logActivity({ agent: this.peer.name, claims: this.claims, tool, outcome });
  }

  /** Cut the agent off (Stop), or note that it left. */
  stop(why: "stopped" | "disconnected"): void {
    if (this.closed) return;
    this.closed = true;
    this.log(null, why);
    // What it was doing stops (nothing more is typed), and its sheets, and a "Your turn" it left up, come down.
    for (const running of this.inFlight.values()) running.abort();
    this.ctx.ui.dismiss(this.id);
    this.connection.terminate();
    this.onGone(this);
  }
}
