/**
 * Where logins come from: Dashi's vault and 1Password (docs/secrets.md,
 * "Sources"), each turned on or off in Settings › Passwords. The broker asks
 * every enabled source for logins matching a site and lists them together,
 * the most recently used first, each saying where it comes from. A source
 * that fails is left out, not fatal.
 */

import type { AgentUse } from "./vault.ts";

export type SourceId = "dashi" | "1password";

export const SOURCE_LABELS: Record<SourceId, string> = { dashi: "Dashi", "1password": "1Password" };

/** A login from one source, without its secrets. */
export interface Login {
  source: SourceId;
  /** The source's own id for it ("12", or 1Password's item id). */
  id: string;
  site: string;
  account: string;
  agents: AgentUse;
  hasCode: boolean;
  /** Unix seconds; null when never used (or the source can't say). */
  lastUsed: number | null;
}

/** A login's key across sources, for the sheet and "Allow for This Task". */
export const loginKey = (login: Pick<Login, "source" | "id">): string => `${login.source}:${login.id}`;

export interface LoginSource {
  readonly id: SourceId;
  logins(site: string): Promise<Login[]>;
  /** The password, for the broker to type and drop. */
  password(login: Login): Promise<Uint8Array>;
  /** The one-time code now. */
  code(login: Login): Promise<string>;
}

/** Most recently used first; then by source (Dashi first), site, and account, so the order is stable. */
export function sortLogins(logins: readonly Login[]): Login[] {
  const order: SourceId[] = ["dashi", "1password"];
  return [...logins].sort(
    (a, b) =>
      (b.lastUsed ?? -1) - (a.lastUsed ?? -1) ||
      order.indexOf(a.source) - order.indexOf(b.source) ||
      a.site.localeCompare(b.site) ||
      a.account.localeCompare(b.account),
  );
}

/** Every enabled source's logins for `site`, together. */
export async function findLogins(sources: readonly LoginSource[], site: string): Promise<{ logins: Login[]; failed: SourceId[] }> {
  const results = await Promise.allSettled(sources.map((source) => source.logins(site)));
  const failed: SourceId[] = [];
  const logins = results.flatMap((result, i) => {
    if (result.status === "fulfilled") return result.value;
    failed.push((sources[i] as LoginSource).id);
    return [];
  });
  return { logins: sortLogins(logins), failed };
}

/** What an agent may be told about a login: where it is from, the site, the account; never a secret. */
export function describeForAgent(login: Login): Record<string, unknown> {
  return { source: SOURCE_LABELS[login.source], site: login.site, account: login.account, hasCode: login.hasCode, agents: login.agents };
}
