/**
 * Connections as agents (decisions.md D137): the sessions of one program
 * for one person (the same executable and script, the same name it claims,
 * the same run) are one agent, however many are connected. A quiet one
 * (session-quiet.ts) is in no group: it is counted apart. Pure.
 */

import type { AgentInfo } from "../presence.ts";

/** At rest: it says nothing of what it does. */
export const isResting = (status: string): boolean => status === "Connected" || status === "Idle";

export interface AgentGroup {
  /** The session that speaks for them all: one that waits on the person, else one at work, else the one that called last. */
  lead: AgentInfo;
  /** Every session in sight, the lead first. */
  members: AgentInfo[];
}

/** What makes two connections the same agent; a connection with no grants' key is its own. */
function groupKey(agent: AgentInfo): string {
  if (agent.key === undefined) return `id:${agent.id}`;
  return [agent.key, agent.claims ?? "", agent.name, agent.remote === true ? "remote" : "", agent.task ?? ""].join("\n");
}

/** How much a session has to say: waiting on the person, at work, seeing the screen, then nothing. */
function weight(agent: AgentInfo): number {
  if (agent.waiting) return 3;
  if (!isResting(agent.status)) return 2;
  return agent.watching ? 1 : 0;
}

const lastCall = (agent: AgentInfo): number => agent.acted ?? agent.since ?? 0;

/** The connections in sight, as agents: in the order their first session connected. */
export function groupConnections(connections: readonly AgentInfo[]): AgentGroup[] {
  const groups = new Map<string, AgentInfo[]>();
  for (const agent of connections) {
    if (agent.quiet) continue;
    const key = groupKey(agent);
    const members = groups.get(key);
    if (members) members.push(agent);
    else groups.set(key, [agent]);
  }
  return [...groups.values()].map((members) => {
    const sorted = [...members].sort((a, b) => weight(b) - weight(a) || lastCall(b) - lastCall(a) || a.id - b.id);
    return { lead: sorted[0] as AgentInfo, members: sorted };
  });
}
