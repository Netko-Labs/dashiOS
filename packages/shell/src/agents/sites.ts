/**
 * Websites an agent may use (docs/actions.md, "Websites"): the browser tools
 * need the "web" scope, and then each site is asked about the first time an
 * agent touches it: "Allow Once" holds for the connection, "Always Allow" is
 * kept (sites.json beside grants.json, by the same agent key), "Don't Allow"
 * holds for the connection, and the agent is told. A site covers its
 * subdomains: allowing bodytech.com.co allows www. and login. too.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stateDir } from "./consent.ts";

/** A page's site: its host without "www.", for http and https pages; null for anything else (a browser page, a file). */
export function siteOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return (host.startsWith("www.") ? host.slice(4) : host) || null;
}

/** Whether allowing `allowed` covers `site`: the same, or a subdomain of it. */
export const covers = (allowed: string, site: string): boolean => site === allowed || site.endsWith(`.${allowed}`);

/** sites.json read: `{version: 1, agents: {key: {site: since}}}`; anything else is nothing kept. */
export function parseSiteGrants(value: unknown): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const agents = typeof value === "object" && value !== null ? (value as Record<string, unknown>).agents : null;
  if (typeof agents !== "object" || agents === null) return out;
  for (const [key, sites] of Object.entries(agents)) {
    if (typeof sites !== "object" || sites === null || Array.isArray(sites)) continue;
    const kept = new Map<string, number>();
    for (const [site, since] of Object.entries(sites)) {
      if (siteOf(`https://${site}/`) === site) kept.set(site, typeof since === "number" ? since : 0);
    }
    out.set(key, kept);
  }
  return out;
}

/** The sites agents may always use, kept across connections. */
export class SiteGrants {
  private readonly byAgent: Map<string, Map<string, number>>;

  /** `path` null keeps them in memory only (tests). */
  constructor(private readonly path: string | null = join(stateDir(), "sites.json")) {
    let read: unknown = null;
    try {
      if (path) read = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // Nothing kept yet.
    }
    this.byAgent = parseSiteGrants(read);
  }

  has(key: string, site: string): boolean {
    return [...(this.byAgent.get(key)?.keys() ?? [])].some((allowed) => covers(allowed, site));
  }

  sites(key: string): string[] {
    return [...(this.byAgent.get(key)?.keys() ?? [])];
  }

  add(key: string, site: string, now: number = Math.floor(Date.now() / 1000)): void {
    const kept = this.byAgent.get(key) ?? new Map<string, number>();
    kept.set(site, now);
    this.byAgent.set(key, kept);
    this.save();
  }

  /** Forget one site, or every site, an agent was allowed. */
  remove(key: string, site?: string): void {
    if (site === undefined) this.byAgent.delete(key);
    else this.byAgent.get(key)?.delete(site);
    this.save();
  }

  private save(): void {
    if (!this.path) return;
    const agents = Object.fromEntries([...this.byAgent].map(([key, sites]) => [key, Object.fromEntries(sites)]));
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify({ version: 1, agents }));
    } catch (error) {
      console.error("dashi-shell: could not save agents' sites:", error);
    }
  }
}

export type SiteAnswer = "once" | "always" | "deny";

/**
 * One connection's sites: asks the person the first time each is touched
 * (one question per site, however many calls wait on it), and remembers the
 * answer for the connection; "always" is kept for the agent.
 */
export class SiteConsent {
  private readonly allowed = new Set<string>();
  private readonly refused = new Set<string>();
  private readonly asking = new Map<string, Promise<boolean>>();

  constructor(
    private readonly grants: SiteGrants,
    private readonly key: () => string,
    /** The person's answer; null when there was none (the call was given up on, the screen locked): nothing is remembered. */
    private readonly ask: (site: string) => Promise<SiteAnswer | null>,
  ) {}

  /** Whether the agent may use `site` without asking. */
  has(site: string): boolean {
    return [...this.allowed].some((allowed) => covers(allowed, site)) || this.grants.has(this.key(), site);
  }

  /** Whether the person refused `site` on this connection. */
  isRefused(site: string): boolean {
    return [...this.refused].some((refused) => covers(refused, site));
  }

  /** Whether the agent may use `site`: allowed already, or the person says so now. */
  async allow(site: string): Promise<boolean> {
    if (this.has(site)) return true;
    if (this.isRefused(site)) return false;
    let pending = this.asking.get(site);
    if (!pending) {
      pending = this.ask(site).then((answer) => {
        this.asking.delete(site);
        if (answer === null) return false;
        if (answer === "deny") {
          this.refused.add(site);
          return false;
        }
        this.allowed.add(site);
        if (answer === "always") this.grants.add(this.key(), site);
        return true;
      });
      this.asking.set(site, pending);
    }
    return pending;
  }
}
