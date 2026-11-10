/**
 * One agent's connection: MCP requests and replies, and the consent each
 * tool call waits on. A call needing a scope the person hasn't decided on
 * waits while the sheet asks; "Don't Allow", or no answer in two minutes,
 * refuses it, and the agent is told so it can adapt. A tool that can lose
 * the person's work asks again on every call (`confirm`), however the scope
 * was answered.
 */

import { type Actor, actingAs } from "../acting.ts";
import type { BrowserBridge } from "../browser/bridge.ts";
import type { Compositor } from "../compositor.ts";
import type { Arrange, Tile } from "../layout.ts";
import { LineBuffer } from "../shared/io/lines.ts";
import type { Undo } from "./ask/plan.ts";
import type { Question } from "./confirm.ts";
import { choices, type Grants, isScope, kept, label, logActivity, type Scope } from "./consent.ts";
import { type RunContext, type ToolResult, toolError } from "./context.ts";
import type { Hands } from "./desktop/hands.ts";
import type { Desktop } from "./desktop/index.ts";
import { LOCKED, LOCKED_WHILE_RUNNING } from "./lock.ts";
import { connectionHarness, watchingOf } from "./mark.ts";
import type { AgentMask } from "./mask.ts";
import * as mcp from "./mcp.ts";
import { grantKey, type Peer } from "./peer.ts";
import { type AgentInfo, type AgentUi, WAITING_STATUS, type Watching, type Who } from "./presence.ts";
import { runCall } from "./run.ts";
import { type SecretsShared, SessionSecrets } from "./secrets/session-secrets.ts";
import { type SiteAnswer, SiteConsent, type SiteGrants } from "./sites.ts";
import { type Call, catalog, INSTRUCTIONS, locksScreen, parseCall, scopeOf } from "./tools/index.ts";
import { WatchClock } from "./watch-clock.ts";

/** How long a finished action stays in the menu bar before "Idle". */
const SETTLE_MS = 3_000;
/** A line longer than this (a runaway client) ends the connection. */
const MAX_LINE = 8 * 1024 * 1024;

export interface SessionContext {
  compositor: Compositor;
  ui: AgentUi;
  desktop: Desktop;
  /** What agents' pictures blank, shared by every connection. */
  mask: AgentMask;
  /** The agent seat, shared by every connection. */
  hands: Hands;
  grants: Grants;
  /** Whether the screen is locked: agents are refused and nobody is asked then. */
  lock: { readonly isLocked: boolean };
  /** The menu bar's list changed. */
  publish(): void;
  tile(window: number, to: Arrange): Promise<void>;
  arrangement(window: number): Tile | null;
  /** Login sources, the accessibility bus, and the windows handed to the person. */
  secrets: SecretsShared;
  /** Dashi's browser extension, when a browser has it (browser/bridge.ts). */
  browser: BrowserBridge;
  /** The websites agents may always use (sites.ts). */
  sites: SiteGrants;
  /** An agent started from the launcher: Undo for its settings changes (agents/handoff/service.ts). */
  tasks?: TaskHooks;
}

/** What a run started from the launcher may do on its connection (agents/handoff/grants.ts). */
export interface TaskPolicy {
  granted: readonly Scope[];
  refused: readonly Scope[];
  /** The window its context chip named: it may hand that one to the person, whatever "Manage windows and apps" says. */
  window: number | null;
  /** The harness's name ("Codex"): what sheets and the activity call the run, whatever its process is. */
  name: string;
  /** The sites the person allowed for this task (not always): every turn's connection shares them. */
  sites?: Set<string>;
}

/** The launcher's runs' side of a call: what would put it back, and that it went well. */
export interface TaskHooks {
  before(task: string, call: Call): Undo | null;
  after(task: string, undo: Undo | null, ok: boolean): void;
}

/** A launcher run on this connection: its id and policy (agents/handoff/). */
export interface SessionTask {
  id: string;
  policy: TaskPolicy;
}

/** What a Bun socket offers the session. */
export interface Connection {
  write(data: Uint8Array): number;
  /** Closes the socket now; nothing more is read or sent (not the graceful half-close of `end()`). */
  terminate(): void;
}

export class Session {
  private claims: string | null = null;
  /** Everything this connection may do now: kept grants and "Allow Once" ones. */
  private readonly granted: Set<Scope>;
  /** The part of `granted` that was allowed only for this connection. */
  private readonly once = new Set<Scope>();
  private readonly refused = new Set<Scope>();
  private asking = false;
  /** Questions about single actions on screen now (`confirm`). */
  private confirming = 0;
  private waiting: Array<{ id: mcp.Id; call: Call }> = [];
  private status = "Connected";
  private statusSerial = 0;
  private readonly lines = new LineBuffer();
  private outbox: Uint8Array[] = [];
  private closed = false;
  private readonly secrets: SessionSecrets;
  /** Calls running now, each to be given up on when the agent cancels it (`notifications/cancelled`). */
  private readonly inFlight = new Map<mcp.Id, AbortController>();
  /** The scope sheet up now, to take down when no waiting call needs it any more. */
  private askAbort: AbortController | null = null;
  /** The websites this connection may use, asked one by one (sites.ts). */
  private readonly sites: SiteConsent;
  /** The browser tab the website tools use when none is named: the agent's last. */
  private browserTab: number | null = null;
  /** When it connected. */
  private readonly since = Date.now();
  /** Calls running now that the menu bar's red dot shows (recording, seeing the screen, its pointer), and since when; one that ended stays as long as its words do (`SETTLE_MS`). */
  private readonly watched = new WatchClock(SETTLE_MS);

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
    this.granted = peer.remote ? new Set() : task ? new Set(task.policy.granted) : ctx.grants.get(peer.key);
    if (task) {
      for (const scope of task.policy.granted) this.once.add(scope);
      for (const scope of task.policy.refused) this.refused.add(scope);
    }
    this.secrets = new SessionSecrets(ctx.secrets, ctx.ui, confined);
    this.sites = new SiteConsent(
      ctx.sites,
      () => grantKey(this.peer, this.claims),
      (site) => this.askSite(site),
      // A launcher run's sites hold for the whole task, through its follow-ups' connections.
      task?.policy.sites,
    );
  }

  /** "<agent> wants to use <site>": the person's answer, or null when there was none (locked, the agent gone). */
  private async askSite(site: string): Promise<SiteAnswer | null> {
    if (this.closed || this.ctx.lock.isLocked) return null;
    this.confirming++;
    this.setStatus(WAITING_STATUS);
    try {
      const answer = await this.ctx.ui.allowSite({ agent: this.id, who: this.who, site });
      return this.closed || this.ctx.lock.isLocked ? null : answer;
    } finally {
      this.confirming--;
      if (!this.asking && this.confirming === 0) this.setStatus("Connected");
    }
  }

  info(): AgentInfo {
    return {
      id: this.id,
      name: this.peer.name,
      key: grantKey(this.peer, this.claims),
      status: this.status,
      scopes: [...this.granted],
      ...(this.task ? { task: this.task.id } : {}),
      detail: this.peer.detail,
      claims: this.claims,
      remote: this.peer.remote,
      harness: connectionHarness(this.peer.name, this.claims),
      since: this.since,
      waiting: this.asking || this.confirming > 0,
      ...this.watchingNow(),
    };
  }

  /** The strongest kind of watching going on now (else the last one, for a moment after it ended), and since when. */
  private watchingNow(): Pick<AgentInfo, "watching" | "watchingSince"> {
    const watched = this.watched.now(Date.now());
    return watched ? { watching: watched.kind, watchingSince: watched.since } : { watching: null };
  }

  private watchStart(kind: Watching | null): void {
    if (!kind) return;
    this.watched.start(kind, Date.now());
    this.ctx.publish();
  }

  private watchEnd(kind: Watching | null): void {
    if (!kind) return;
    this.watched.end(kind, Date.now());
    this.ctx.publish();
    // The dot goes once the moment is over, whatever else happens meanwhile.
    setTimeout(() => {
      if (!this.closed) this.ctx.publish();
    }, SETTLE_MS + 50);
  }

  /** Who this agent is in what it changes: the name it shows with (a remote one's claimed name), and its grants' key. */
  private actor(): Actor {
    const name = this.peer.remote ? (this.claims ?? "") : this.peer.name;
    return { agent: name.replace(/\p{Cc}/gu, "").slice(0, 32) || "Agent", key: grantKey(this.peer, this.claims) };
  }

  /**
   * Settings revoked what this agent was allowed for good: the connection stops
   * holding it (including what it was allowed once) and is asked again. With
   * `scopes`, only those were taken back (Privacy & Security, one at a time).
   */
  revoke(key: string, scopes?: readonly Scope[]): void {
    if (grantKey(this.peer, this.claims) !== key) return;
    if (scopes) {
      for (const scope of scopes) {
        this.granted.delete(scope);
        this.once.delete(scope);
      }
      return;
    }
    this.granted.clear();
    this.once.clear();
  }

  receive(chunk: Uint8Array): void {
    // A stopped agent's connection may still deliver what was already on its way.
    if (this.closed) return;
    const lines = this.lines.push(chunk);
    if (this.lines.pending > MAX_LINE) {
      this.stop("disconnected");
      return;
    }
    for (const line of lines) {
      // Stopping on one line (a revoked agent, a bad frame) leaves the rest of the chunk unread.
      if (this.closed) return;
      if (line.trim()) this.handle(line);
    }
  }

  /** The socket can take more: flush what waited. */
  drain(): void {
    while (this.outbox.length > 0) {
      const next = this.outbox[0] as Uint8Array;
      const written = this.connection.write(next);
      if (written < next.byteLength) {
        this.outbox[0] = next.subarray(Math.max(written, 0));
        return;
      }
      this.outbox.shift();
    }
  }

  private send(message: unknown): void {
    if (this.closed) return;
    this.outbox.push(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
    if (this.outbox.length === 1) this.drain();
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
        const info = params.clientInfo as Record<string, unknown> | undefined;
        const name = typeof info?.name === "string" ? info.name : null;
        // Control characters out, and short: it is shown on the sheet.
        this.claims = name ? name.replace(/\p{Cc}/gu, "").slice(0, 64) : null;
        // An agent over SSH is known by its name; its stored grants show up now. A launcher run has its card's only.
        if (!this.task) for (const scope of this.ctx.grants.get(grantKey(this.peer, this.claims))) this.granted.add(scope);
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
        return this.call(id, call);
      }
      default:
        this.send(mcp.error(id, mcp.METHOD_NOT_FOUND, "Method not found"));
    }
  }

  /** Run `call` if allowed, refuse it if refused, or ask and wait. */
  private call(id: mcp.Id, call: Call): void {
    if (this.closed) return;
    // Locked: no tool runs and no sheet goes up, whatever has been allowed.
    if (this.ctx.lock.isLocked) return this.reply(id, call.name, toolError(LOCKED));
    const scope = scopeOf(call);
    // A launcher run may hand the window its context chip named to the person.
    const handsOwnWindow = call.name === "hand_over" && this.task !== null && call.window === this.task.policy.window;
    if (this.granted.has(scope) || handsOwnWindow) {
      void this.run(id, call);
    } else if (this.refused.has(scope)) {
      this.reply(
        id,
        call.name,
        toolError(
          this.task?.policy.refused.includes(scope)
            ? `"${label(scope)}" isn't allowed for this task: it can't see your other windows or files. Say what you need in your last words instead.`
            : `The person did not allow "${label(scope)}". Tell them what you need it for; don't call this again unless they agree.`,
        ),
      );
    } else {
      this.waiting.push({ id, call });
      void this.ask();
    }
  }

  /** The screen locked: a sheet nobody can reach comes down. */
  screenLocked(): void {
    // Its answer is "Don't Allow", but ask() sees the lock and fails the
    // waiting calls without remembering a refusal.
    if (!this.closed && (this.asking || this.confirming > 0)) this.ctx.ui.dismiss(this.id);
  }

  private get who(): Who {
    return { name: this.peer.name, detail: this.peer.detail, claims: this.claims, remote: this.peer.remote };
  }

  /** Put up the sheet for what the waiting calls need. */
  private async ask(): Promise<void> {
    if (this.asking) return;
    if (this.ctx.lock.isLocked) return this.failWaiting();
    const needs = new Set(this.waiting.map(({ call }) => scopeOf(call)).filter((s) => !this.granted.has(s) && !this.refused.has(s)));
    if (needs.size === 0) return;
    this.asking = true;
    this.setStatus(WAITING_STATUS);
    const ask = { agent: this.id, who: this.who, scopes: choices(needs, this.granted) };
    const controller = new AbortController();
    this.askAbort = controller;
    // The sheet's own clock (sheet-queue.ts) turns an unanswered one into "Don't Allow".
    const answer = await this.ctx.ui.ask(ask, controller.signal);
    this.asking = false;
    this.askAbort = null;
    if (this.closed) return;
    if (controller.signal.aborted) {
      // Every call it was for was given up on: no answer, and no refusal kept.
      this.setStatus("Connected");
      if (this.waiting.length > 0) void this.ask();
      return;
    }
    if (this.ctx.lock.isLocked) {
      // Whatever came back was not an answer: the lock screen was in the way.
      this.status = "Connected";
      this.failWaiting();
      this.ctx.publish();
      return;
    }
    // Whatever the person ticked, needed now or not.
    const allowed = answer.allow === "deny" ? [] : answer.scopes.filter(isScope);
    for (const scope of allowed) {
      if (answer.allow === "once" && !this.granted.has(scope)) this.once.add(scope);
      this.granted.add(scope);
      this.refused.delete(scope);
    }
    for (const scope of needs) if (!this.granted.has(scope)) this.refused.add(scope);
    if (answer.allow === "always") {
      // The store is shared by every connection, so another connection of this
      // agent may have kept grants since this one began: add to what is there now.
      const key = grantKey(this.peer, this.claims);
      this.ctx.grants.set(key, kept(this.ctx.grants.get(key), allowed, this.once));
    }
    this.status = "Connected";
    const waiting = this.waiting;
    this.waiting = [];
    for (const { id, call } of waiting) this.call(id, call);
    this.ctx.publish();
  }

  private failWaiting(): void {
    const waiting = this.waiting;
    this.waiting = [];
    for (const { id, call } of waiting) this.reply(id, call.name, toolError(LOCKED));
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
    const before = this.waiting.length;
    this.waiting = this.waiting.filter((entry) => entry.id !== id);
    if (this.waiting.length < before) this.log(null, "cancelled");
    if (this.waiting.length === 0) this.askAbort?.abort();
  }

  private async run(id: mcp.Id, call: Call): Promise<void> {
    const controller = new AbortController();
    this.inFlight.set(id, controller);
    const { signal } = controller;
    let result: ToolResult;
    const task = this.task;
    const undo = task ? (this.ctx.tasks?.before(task.id, call) ?? null) : null;
    const watch = watchingOf(call.name);
    this.watchStart(watch);
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
            mayName: () => this.granted.has("see"),
            browser: this.browserRun(),
            confirm: (question) => this.confirm(question, signal),
            signal,
          }),
        ),
      );
    } catch (error) {
      result = toolError(`${call.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.inFlight.delete(id);
      this.watchEnd(watch);
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

  /** The website tools' side of this connection: the extension, its sites, its tab. */
  private browserRun(): RunContext["browser"] {
    const session = this;
    return {
      link: () => this.ctx.browser.current(),
      whenConnected: (ms) => this.ctx.browser.whenConnected(ms),
      allowSite: (site) => this.sites.allow(site),
      mayUse: (site) => this.sites.has(site),
      get tab() {
        return session.browserTab;
      },
      set tab(tab: number | null) {
        session.browserTab = tab;
      },
    };
  }

  /**
   * Ask about this one action. Unlike a scope, the answer is not kept and
   * "Always Allow" doesn't apply, so the next call asks again. Anything but a
   * yes is a no: Don't Allow, two minutes of silence, the agent leaving, or
   * the screen locking.
   */
  private async confirm(question: Question, signal: AbortSignal): Promise<boolean> {
    if (this.closed || this.ctx.lock.isLocked || signal.aborted) return false;
    this.confirming++;
    this.setStatus(WAITING_STATUS);
    try {
      const yes = await this.ctx.ui.confirm({ agent: this.id, who: this.who, ...question }, signal);
      return yes && !this.closed && !this.ctx.lock.isLocked && !signal.aborted;
    } finally {
      this.confirming--;
      if (!this.asking && this.confirming === 0) this.setStatus("Connected");
    }
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
      if (this.closed || this.statusSerial !== serial || this.asking) return;
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
