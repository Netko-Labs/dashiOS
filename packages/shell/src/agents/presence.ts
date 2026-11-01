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
}

export type Allow = "once" | "always" | "deny";

export interface Answer {
  allow: Allow;
  scopes: string[];
}

export interface AgentInfo {
  id: number;
  name: string;
  status: string;
  scopes: string[];
}

/** What the agents server needs from the shell's UI. */
export interface AgentUi {
  /** Show the sheet (queued behind others); resolves with the person's answer. */
  ask(ask: Ask): Promise<Answer>;
  /** Ask about one action, in the same queue; resolves true only if the person goes ahead. */
  confirm(confirm: Confirm): Promise<boolean>;
  /** Take down this agent's sheets (it left, the screen locked, or nobody answered). */
  dismiss(agent: number): void;
  /** Say who ⌃❖Esc or Stop just cut off. */
  stopped(names: readonly string[]): void;
  /** Resolves once no consent sheet is on screen (screenshots wait for it). */
  whenNoSheet(): Promise<void>;
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
