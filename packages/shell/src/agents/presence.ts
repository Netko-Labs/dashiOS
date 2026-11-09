/**
 * What the person sees of agents, as data: who is asking and for what (the
 * consent sheet), who is connected and what each is doing (the menu bar),
 * and the hooks the server uses to show them. The UI is consent.tsx.
 */

import { useSyncExternalStore } from "react";

export interface ScopeChoice {
  id: string;
  label: string;
  detail: string;
  checked: boolean;
  /** What the agent's waiting calls need now. */
  needed: boolean;
}

export interface Who {
  /** The agent's process name, found from the connection. */
  name: string;
  /** Where it runs from. */
  detail: string;
  /** What the agent says it is; unverified. */
  claims: string | null;
  remote: boolean;
}

export interface Ask {
  agent: number;
  who: Who;
  scopes: ScopeChoice[];
}

/**
 * A question about one thing an agent is about to do, asked every time and
 * never kept (force quitting an app): "<agent> wants to <summary>".
 */
export interface Confirm {
  agent: number;
  who: Who;
  /** What it wants to do, as a phrase after "wants to": `force “Notes” to quit`. */
  summary: string;
  /** What will happen, in a sentence or two. */
  detail: string;
  /** The button that goes ahead: "Force Quit". */
  action: string;
  /** Losing work or a thing that can't be taken back: the button is red; else it is the primary one (agents/confirm.ts). */
  danger?: boolean;
}

/** "<agent> wants to use bodytech.com.co": a site the website tools touch for the first time (sites.ts). */
export interface SiteAsk {
  agent: number;
  who: Who;
  site: string;
}

/** "<agent> wants to sign in to github.com": which saved login, and for how long (secrets/broker.ts). */
export interface SignInAsk {
  agent: number;
  who: Who;
  /** A phrase after "wants to": "sign in to github.com". */
  summary: string;
  logins: ReadonlyArray<{ key: string; account: string; site: string; source: string }>;
}

/** The person's answer: which login (its key), for this once or the whole task. */
export interface SignInChoice {
  allow: "once" | "task" | "deny";
  login: string | null;
}

/** "Your turn": the person does something in a window, then presses Done. */
export interface Turn {
  agent: number;
  who: Who;
  /** What the agent asks the person to do. */
  reason: string;
  /** The window handed over, which "Now" in the launcher brings forward. */
  window?: number;
}

export type Allow = "once" | "always" | "deny";

export interface Answer {
  allow: Allow;
  scopes: string[];
}

/** What an agent's call does that the person must always see (the mark's red dot): records or sees the screen, or uses its own pointer and keys. */
export type Watching = "recording" | "screen" | "pointer";

export interface AgentInfo {
  id: number;
  name: string;
  /** Its key in the kept answers (consent.ts), so Settings › Agents can say it is connected now. */
  key?: string;
  status: string;
  scopes: string[];
  /** A run started from the launcher (agents/handoff/): its card speaks for it, not a row of its own. */
  task?: string;
  /** Where it runs from (a path, "connected over SSH"), for its row in the agents' panel. */
  detail?: string;
  /** What it says it is (MCP's clientInfo); unverified. */
  claims?: string | null;
  remote?: boolean;
  /** The harness its glyph is (agents/mark.ts `connectionHarness`), or none: the sparkle. */
  harness?: string | null;
  /** When it connected (ms). */
  since?: number;
  /** A call of it is waiting on the person (a sheet). */
  waiting?: boolean;
  /** It records or sees the screen, or uses its pointer and keys, now or a moment ago. */
  watching?: Watching | null;
  /** Since when it has been doing what `watching` says (ms), for its row's time (agents-rows.tsx). */
  watchingSince?: number;
}

/** What the agents server needs from the shell's UI. */
export interface AgentUi {
  /** Show the sheet (queued behind others); resolves with the person's answer. */
  ask(ask: Ask, signal?: AbortSignal): Promise<Answer>;
  /** Ask about one action, in the same queue; resolves true only if the person goes ahead. */
  confirm(confirm: Confirm, signal?: AbortSignal): Promise<boolean>;
  /** Ask whether an agent may use a website: once, always, or not (sites.ts). */
  allowSite(ask: SiteAsk, signal?: AbortSignal): Promise<Allow>;
  /** Ask which login an agent may use, in the same queue; only the person's own press answers yes. */
  signIn(ask: SignInAsk, signal?: AbortSignal): Promise<SignInChoice>;
  /** Show "Your turn" until the person presses Done (true) or it is taken down (false). */
  turn(turn: Turn, signal?: AbortSignal): Promise<boolean>;
  /** Take down this agent's sheets (it left, the screen locked, or nobody answered). */
  dismiss(agent: number): void;
  /** Say who ⌃❖Esc or Stop just cut off. */
  stopped(names: readonly string[]): void;
  /** Resolves once no consent sheet is on screen (screenshots wait for it). */
  whenNoSheet(): Promise<void>;
}

/** An agent's status while a sheet of its asks the person something (session.ts): it waits for you. */
export const WAITING_STATUS = "Waiting for you";

/** How many agents wait for the person now (Settings' sidebar counts them on Agents). */
export function waitingCount(agents: readonly Pick<AgentInfo, "status">[]): number {
  return agents.filter((agent) => agent.status === WAITING_STATUS).length;
}

/** Who is connected, for the menu bar. */
export class AgentStore {
  private agents: readonly AgentInfo[] = [];
  private readonly listeners = new Set<() => void>();

  set(agents: readonly AgentInfo[]): void {
    this.agents = agents;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly AgentInfo[] => this.agents;
}

export function useAgents(store: AgentStore): readonly AgentInfo[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
