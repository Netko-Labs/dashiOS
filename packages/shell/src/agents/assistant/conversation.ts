/**
 * The conversation with Dashi's assistant (decisions.md D147): one at a
 * time, open from the first thing said until two minutes after Dashi's last
 * word with nothing said back, or until the person ends it ("that's all",
 * "new topic", "forget that", ❖Esc, the lock). While it is open, everything
 * said continues it: nothing guesses whether a sentence is a new subject.
 *
 * It keeps what a later ask needs: the harness's session to resume, or the
 * messages for a model the shell drives; the sites used; what can be
 * undone; and the exchanges in words, which also go to
 * `$XDG_STATE_HOME/dashi/agents/conversations.jsonl`.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { realTimers, type Timers } from "../../shared/time/index.ts";
import type { Undo } from "../ask/index.ts";
import { stateDir } from "../consent.ts";

/** It closes this long after Dashi's last word with nothing said. */
export const TALK_OPEN_MS = 120_000;

/** One thing said and what came of it, in words. */
export interface Exchange {
  time: number;
  asked: string;
  said: string;
  /** What Dashi did, in its own words, in order. */
  steps: readonly string[];
  /** The person stopped it (the key, ❖Esc) before it ended. */
  interrupted?: true;
}

export type TalkEnd = "quiet" | "said" | "stopped" | "locked";

/** Where the exchanges are kept in words. */
export interface TalkLog {
  add(line: Record<string, unknown>): void;
}

export const talkLogPath = (): string => join(stateDir(), "conversations.jsonl");

/** The file: one line an exchange, and one when a conversation closes. */
export function fileTalkLog(path: string = talkLogPath()): TalkLog {
  return {
    add(line) {
      try {
        mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
        appendFileSync(path, `${JSON.stringify({ v: 1, ...line })}\n`, { mode: 0o600 });
      } catch (error) {
        console.error("dashi-shell: could not keep the conversation:", error);
      }
    },
  };
}

export interface ConversationDeps {
  timers?: Timers;
  now?(): number;
  log?: TalkLog;
  /** A new conversation's id: letters and digits, as its sandbox's scope name needs (sandbox.ts `taskOfCgroup`). */
  newId?(): string;
  openMs?: number;
  /** It closed: what it held is let go (its connections, a harness still running). */
  closed?(id: string, why: TalkEnd): void;
}

const randomId = (): string => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

export class Conversation {
  /** The one that is open; null between conversations. */
  private current: { id: string; started: number } | null = null;
  private timer: unknown = null;
  private readonly timers: Timers;
  private readonly listeners = new Set<() => void>();
  /** What the exchanges of the open conversation were, oldest first. */
  exchanges: Exchange[] = [];
  /** The harness's own session, resumed by every ask while it is open. */
  session: string | null = null;
  /** The messages, for a model the shell drives itself. */
  messages: unknown[] = [];
  /** The sites used in it: allowed for it, kept for good only by the person in Settings. */
  sites = new Set<string>();
  /** What can be taken back, the newest last. */
  undos: Array<{ undo: Undo; undone: boolean }> = [];

  constructor(private readonly deps: ConversationDeps = {}) {
    this.timers = deps.timers ?? realTimers;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  open = (): boolean => this.current !== null;

  /** The open conversation's id; null when none is. */
  get id(): string | null {
    return this.current?.id ?? null;
  }

  /** Something is said: the open conversation goes on, or a new one begins. Its id, and whether it is new. */
  begin(): { id: string; fresh: boolean } {
    this.busy();
    if (this.current) return { id: this.current.id, fresh: false };
    this.current = { id: this.deps.newId?.() ?? randomId(), started: this.now() };
    this.exchanges = [];
    this.session = null;
    this.messages = [];
    this.sites = new Set();
    this.undos = [];
    this.tell();
    return { id: this.current.id, fresh: true };
  }

  /** Something is being said or done: it does not close meanwhile. */
  busy = (): void => {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  };

  /** Dashi's last word was said, or nothing was said back: it closes a while after this, unless something is said. */
  rested = (): void => {
    this.busy();
    if (this.current) this.timer = this.timers.set(() => this.end("quiet"), this.deps.openMs ?? TALK_OPEN_MS);
  };

  /** It is over: the next thing said starts a new one. */
  end = (why: TalkEnd): void => {
    this.busy();
    const was = this.current;
    if (!was) return;
    this.current = null;
    this.deps.log?.add({ conversation: was.id, time: Math.floor(this.now() / 1000), closed: why, exchanges: this.exchanges.length });
    this.deps.closed?.(was.id, why);
    this.tell();
  };

  /**
   * An exchange of conversation `id` ended: it is kept in words, for the next ask and for the file. One that was
   * stopped by what also closed the conversation (❖Esc, the lock) is still written down.
   */
  record(id: string, exchange: Exchange): void {
    if (this.current?.id === id) this.exchanges.push(exchange);
    this.deps.log?.add({
      conversation: id,
      time: Math.floor(exchange.time / 1000),
      asked: exchange.asked,
      said: exchange.said,
      steps: exchange.steps,
      ...(exchange.interrupted ? { interrupted: true } : {}),
    });
  }

  private tell(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
