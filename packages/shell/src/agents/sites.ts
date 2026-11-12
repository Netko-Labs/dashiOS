/**
 * Websites an agent may use (docs/actions.md, "Websites"): the browser tools
 * need the "web" scope, and then each site is asked about the first time an
 * agent touches it: "Allow Once" holds for the connection, "Always Allow" is
 * kept (sites.json beside grants.json, by the same agent key), "Don't Allow"
 * holds for the connection, and the agent is told. A site covers its
 * subdomains: allowing bodytech.com.co allows www. and login. too.
 *
 * The person may also allow sites ahead of time, for every agent (Settings ›
 * Agents, "Sites agents may use"; sites.json's `person`), so an agent left to
 * work alone (an unattended demo) opens them with no sheet. Only Settings
 * writes that list: no agent's answer or tool adds to it.
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

/** A site the person typed: an address ("https://www.bodytech.com.co/clases") or a host ("bodytech.com.co"); null when it is neither. */
export function siteFromInput(text: string): string | null {
  const words = text.trim();
  if (!words || /\s/.test(words)) return null;
  const site = siteOf(words.includes("://") ? words : `https://${words}`);
  // A host needs a dot (or is localhost): "bodytech" alone is a typo, not a site.
  return site && (site.includes(".") || site === "localhost") ? site : null;
}

/** sites.json's `person`: `{site: since}`; anything unreadable is left out. */
export function parsePersonSites(value: unknown): Map<string, number> {
  const person = typeof value === "object" && value !== null ? (value as Record<string, unknown>).person : null;
  const out = new Map<string, number>();
  if (typeof person !== "object" || person === null || Array.isArray(person)) return out;
  for (const [site, since] of Object.entries(person)) {
    if (siteOf(`https://${site}/`) === site) out.set(site, typeof since === "number" ? since : 0);
  }
  return out;
}

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
  /** The person's own list, for every agent (Settings › Agents). */
  private readonly person: Map<string, number>;
  private aheadSnapshot: readonly string[] = [];
  private readonly listeners = new Set<() => void>();

  /** `path` null keeps them in memory only (tests). */
  constructor(private readonly path: string | null = join(stateDir(), "sites.json")) {
    let read: unknown = null;
    try {
      if (path) read = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // Nothing kept yet.
    }
    this.byAgent = parseSiteGrants(read);
    this.person = parsePersonSites(read);
    this.aheadSnapshot = [...this.person.keys()];
  }

  has(key: string, site: string): boolean {
    return [...(this.byAgent.get(key)?.keys() ?? []), ...this.person.keys()].some((allowed) => covers(allowed, site));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The sites the person allowed ahead of time, in the order added. */
  ahead = (): readonly string[] => this.aheadSnapshot;

  /** Allow a site for every agent ahead of time (Settings only). */
  allowAhead(site: string, now: number = Math.floor(Date.now() / 1000)): void {
    if (this.person.has(site)) return;
    this.person.set(site, now);
    this.aheadChanged();
  }

  /** Take a site off the person's list: agents ask for it again. */
  forgetAhead(site: string): void {
    if (!this.person.delete(site)) return;
    this.aheadChanged();
  }

  private aheadChanged(): void {
    this.aheadSnapshot = [...this.person.keys()];
    this.save();
    for (const listener of this.listeners) listener();
  }

  /** Every site some agent was always allowed, for Work alone's first picks (alone/rules.ts). */
  everyAgents(): string[] {
    return [...new Set([...this.byAgent.values()].flatMap((sites) => [...sites.keys()]))];
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
      writeFileSync(this.path, JSON.stringify({ version: 1, agents, person: Object.fromEntries(this.person) }));
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
  private readonly refused = new Set<string>();
  private readonly asking = new Map<string, Promise<boolean>>();

  constructor(
    private readonly grants: SiteGrants,
    private readonly key: () => string,
    /** The person's answer; null when there was none (the call was given up on, the screen locked): nothing is remembered. */
    private readonly ask: (site: string) => Promise<SiteAnswer | null>,
    /** The sites allowed for a while: this connection's, or a launcher run's for all its turns (shared). */
    private readonly allowed: Set<string> = new Set(),
    /** Sites used without asking for a while, whoever the agent is (Work alone, alone/): nothing is kept. */
    private readonly free: (site: string) => boolean = () => false,
  ) {}

  /** Whether the agent may use `site` without asking. */
  has(site: string): boolean {
    return [...this.allowed].some((allowed) => covers(allowed, site)) || this.grants.has(this.key(), site) || this.free(site);
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
