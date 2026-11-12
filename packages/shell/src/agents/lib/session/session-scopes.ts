/**
 * What one connection may do: the scopes it holds, the ones refused, and the
 * calls waiting while the sheet asks. A call needing a scope the person hasn't
 * decided on waits; "Don't Allow", or no answer in two minutes, refuses it, and
 * the agent is told so it can adapt. Locked, nothing runs and nobody is asked.
 */

import type { Question } from "../../confirm.ts";
import { choices, isScope, kept, label, type Scope } from "../../consent.ts";
import { type ToolResult, toolError } from "../../context.ts";
import { LOCKED } from "../../lock.ts";
import { type PersonAnswer, WAITING_STATUS, type Who } from "../../presence.ts";
import type { SiteAnswer } from "../../sites.ts";
import { type Call, scopeOf } from "../../tools/index.ts";
import type * as mcp from "../mcp.ts";
import type { SessionContext, SessionTask } from "./session-types.ts";

/** What the scopes need of the connection they are for. */
export interface ScopeHost {
  readonly id: number;
  who(): Who;
  /** The key this agent's grants are kept under (its peer, and the name it claimed). */
  grantKey(): string;
  closed(): boolean;
  /** The words under its name in the menu bar. */
  setStatus(text: string): void;
  /** The status without announcing it yet: the caller publishes. */
  resetStatus(): void;
  /** A call that may run now; `free` when only Work alone lets it (the agent was never allowed it). */
  run(id: mcp.Id, call: Call, free?: boolean): void;
  /** A call that didn't run. */
  reply(id: mcp.Id, tool: string, result: ToolResult): void;
}

export class Scopes {
  /** Everything this connection may do now: kept grants and "Allow Once" ones. */
  readonly granted: Set<Scope>;
  /** The part of `granted` that was allowed only for this connection. */
  private readonly once = new Set<Scope>();
  private readonly refused = new Set<Scope>();
  private waiting: Array<{ id: mcp.Id; call: Call }> = [];
  /** The scope sheet up now, to take down when no waiting call needs it any more. */
  private askAbort: AbortController | null = null;
  private sheet = false;
  /** Questions about single actions or sites on screen now (`confirm`, `askSite`). */
  private confirming = 0;

  constructor(
    granted: Set<Scope>,
    private readonly ctx: SessionContext,
    private readonly host: ScopeHost,
    private readonly task: SessionTask | null,
  ) {
    this.granted = granted;
    if (task) {
      for (const scope of task.policy.granted) this.once.add(scope);
      for (const scope of task.policy.refused) this.refused.add(scope);
    }
  }

  /** Whether the scope sheet is up. */
  get asking(): boolean {
    return this.sheet;
  }

  /** Whether any sheet of this connection is up. */
  get busy(): boolean {
    return this.sheet || this.confirming > 0;
  }

  /** The grants kept for this agent, now that its name is known. */
  loadKept(): void {
    for (const scope of this.ctx.grants.get(this.host.grantKey())) this.granted.add(scope);
  }

  /**
   * Settings revoked what this agent was allowed for good: the connection stops
   * holding it (including what it was allowed once) and is asked again. With
   * `scopes`, only those were taken back (Privacy & Security, one at a time).
   */
  revoke(scopes?: readonly Scope[]): void {
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

  /** Run `call` if allowed, refuse it if refused, or ask and wait. */
  call(id: mcp.Id, call: Call): void {
    if (this.host.closed()) return;
    // Locked: no tool runs and no sheet goes up, whatever has been allowed.
    if (this.ctx.lock.isLocked) return this.host.reply(id, call.name, toolError(LOCKED));
    const scope = scopeOf(call);
    // A launcher run may hand the window its context chip named to the person.
    const handsOwnWindow = call.name === "hand_over" && this.task !== null && call.window === this.task.policy.window;
    // Whether Work alone is on is no secret, and an agent left alone must be able to plan: it never asks.
    const asksAboutAlone = call.name === "get_work_alone";
    if (this.granted.has(scope) || handsOwnWindow || asksAboutAlone) {
      this.host.run(id, call);
    } else if (this.worksAlone(call.name, scope)) {
      this.host.run(id, call, true);
    } else if (this.refused.has(scope)) {
      this.host.reply(
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

  /**
   * Whether Work alone lets `tool` run though this connection was never
   * allowed `scope` (alone/): the person picked its kind, for a while. Never
   * for what a launcher run's card refused, and nothing is kept: when it
   * ends, the next call asks.
   */
  private worksAlone(tool: string, scope: Scope): boolean {
    if (this.task?.policy.refused.includes(scope)) return false;
    return this.ctx.alone?.covers(tool, scope) === true;
  }

  /** Whether this connection holds `scope` now: allowed, or Work alone covers it. */
  holds(scope: Scope): boolean {
    return this.granted.has(scope) || (!this.task?.policy.refused.includes(scope) && this.ctx.alone?.holds(scope) === true);
  }

  /** Put up the sheet for what the waiting calls need. */
  private async ask(): Promise<void> {
    if (this.sheet) return;
    if (this.ctx.lock.isLocked) return this.failWaiting();
    const needs = new Set(this.waiting.map(({ call }) => scopeOf(call)).filter((s) => !this.granted.has(s) && !this.refused.has(s)));
    if (needs.size === 0) return;
    this.sheet = true;
    this.host.setStatus(WAITING_STATUS);
    const ask = { agent: this.host.id, who: this.host.who(), scopes: choices(needs, this.granted) };
    const controller = new AbortController();
    this.askAbort = controller;
    // The sheet's own clock (sheet-queue.ts) turns an unanswered one into "Don't Allow".
    const answer = await this.ctx.ui.ask(ask, controller.signal);
    this.sheet = false;
    this.askAbort = null;
    if (this.host.closed()) return;
    if (controller.signal.aborted) {
      // Every call it was for was given up on: no answer, and no refusal kept.
      this.host.setStatus("Connected");
      if (this.waiting.length > 0) void this.ask();
      return;
    }
    if (this.ctx.lock.isLocked) {
      // Whatever came back was not an answer: the lock screen was in the way.
      this.host.resetStatus();
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
      const key = this.host.grantKey();
      this.ctx.grants.set(key, kept(this.ctx.grants.get(key), allowed, this.once));
    }
    this.host.resetStatus();
    const waiting = this.waiting;
    this.waiting = [];
    for (const { id, call } of waiting) this.call(id, call);
    this.ctx.publish();
  }

  private failWaiting(): void {
    const waiting = this.waiting;
    this.waiting = [];
    for (const { id, call } of waiting) this.host.reply(id, call.name, toolError(LOCKED));
  }

  /** The agent gave up on request `id` while it waited: it is dropped, and the sheet comes down when nothing needs it. True when it was waiting. */
  drop(id: mcp.Id): boolean {
    const before = this.waiting.length;
    this.waiting = this.waiting.filter((entry) => entry.id !== id);
    if (this.waiting.length === 0) this.askAbort?.abort();
    return this.waiting.length < before;
  }

  /** "<agent> wants to use <site>": the person's answer, or null when there was none (locked, the agent gone). */
  async askSite(site: string): Promise<SiteAnswer | null> {
    if (this.host.closed() || this.ctx.lock.isLocked) return null;
    return this.whileConfirming(async () => {
      const answer = await this.ctx.ui.allowSite({ agent: this.host.id, who: this.host.who(), site });
      return this.host.closed() || this.ctx.lock.isLocked ? null : answer;
    });
  }

  /**
   * Ask about this one action. Unlike a scope, the answer is not kept and
   * "Always Allow" doesn't apply, so the next call asks again. Anything but a
   * yes is a no: Don't Allow, two minutes of silence, the agent leaving, or
   * the screen locking.
   */
  async confirm(question: Question, signal: AbortSignal): Promise<boolean> {
    if (this.host.closed() || this.ctx.lock.isLocked || signal.aborted) return false;
    return this.whileConfirming(async () => {
      const yes = await this.ctx.ui.confirm({ agent: this.host.id, who: this.host.who(), ...question }, signal);
      return yes && !this.host.closed() && !this.ctx.lock.isLocked && !signal.aborted;
    });
  }

  /** A question in words (`ask_person`): the person's own, or that there is none (they said no, the time ran out, the agent left, the screen locked). */
  async question(question: string, seconds: number, signal: AbortSignal): Promise<PersonAnswer> {
    const none: PersonAnswer = { none: "no-answer" };
    if (this.host.closed() || this.ctx.lock.isLocked || signal.aborted) return none;
    return this.whileConfirming(async () => {
      const answer = await this.ctx.ui.question({ agent: this.host.id, who: this.host.who(), question, seconds }, signal);
      return this.host.closed() || this.ctx.lock.isLocked || signal.aborted ? none : answer;
    });
  }

  /** What a running call asks the person through. */
  asks(signal: AbortSignal): { confirm(question: Question): Promise<boolean>; question(question: string, seconds: number): Promise<PersonAnswer> } {
    return { confirm: (question) => this.confirm(question, signal), question: (question, seconds) => this.question(question, seconds, signal) };
  }

  /** Waiting on the person for a question: the status says so, and goes back when the last one is answered. */
  private async whileConfirming<T>(question: () => Promise<T>): Promise<T> {
    this.confirming++;
    this.host.setStatus(WAITING_STATUS);
    try {
      return await question();
    } finally {
      this.confirming--;
      if (!this.sheet && this.confirming === 0) this.host.setStatus("Connected");
    }
  }
}
