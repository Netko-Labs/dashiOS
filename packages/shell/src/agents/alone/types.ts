/** Work alone as data: what the person picked, what runs now, and the record of what agents did meanwhile. */

import type { Scope } from "../consent.ts";

/** What the person picked in Settings › Agents. */
export interface AloneConfig {
  /** What agents may do without asking. */
  scopes: readonly Scope[];
  /** The sites they may use without asking; a site covers its subdomains. */
  sites: readonly string[];
  /** For how long. */
  minutes: number;
  /** Keep it on after the screen locks (agents still do nothing while it is locked). */
  throughLock: boolean;
}

export type AloneState =
  | { on: false }
  | {
      on: true;
      /** When it started and when it ends (ms). */
      started: number;
      ends: number;
      scopes: readonly Scope[];
      sites: readonly string[];
      throughLock: boolean;
    };

/** Why it ended: the person's stop, the time, the screen locking, logging out, or ⌃❖Esc. */
export type AloneEnd = "stopped" | "time" | "locked" | "logout";

/** One tool call an agent made while it ran: never its arguments, text or pictures. */
export interface AloneCall {
  /** When it finished (ms). */
  time: number;
  agent: string;
  tool: string;
  /** The sites it touched. */
  sites: string[];
  outcome: "ok" | "error" | "cancelled";
  /** It ran without asking because Work alone was on (the agent had not been allowed it before). */
  free: boolean;
}

export interface AloneRecord {
  started: number;
  ended: number;
  why: AloneEnd;
  scopes: Scope[];
  sites: string[];
  calls: AloneCall[];
  /** Calls past the most a record keeps. */
  more: number;
}

/** What an agent is told when it asks (`get_work_alone`): read-only. */
export interface AloneStatus {
  on: boolean;
  /** Whole seconds left; 0 when off. */
  secondsLeft: number;
  scopes: string[];
  sites: string[];
}

/** What a connection asks of Work alone (lib/session/). */
export interface AloneGate {
  /** Whether `tool`, which needs `scope`, runs without asking now. */
  covers(tool: string, scope: Scope): boolean;
  /** Whether `scope` is one agents hold now. */
  holds(scope: Scope): boolean;
  /** Whether `site` is used without asking now. */
  site(site: string): boolean;
  /** A call finished. */
  note(call: Omit<AloneCall, "time">): void;
  status(): AloneStatus;
}

/** What starting it came to. */
export type AloneStart = { ok: true } | { ok: false; why: string };
