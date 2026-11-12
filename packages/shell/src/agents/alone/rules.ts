/**
 * What Work alone can and can never cover (docs/actions.md, "Working
 * alone"). Pure. Whatever the person picks, and whatever a file or a caller
 * says, these never run without asking: payments, sign-ins and codes (the
 * fingerprint or password, the vault), the clipboard history, force quit,
 * the Trash, and installing or updating software.
 */

import { ASKS_EVERY_TIME } from "../../actions/tools.ts";
import { type GrantEntry, isScope, SCOPES, type Scope } from "../consent.ts";
import { covers as siteCovers, siteFromInput } from "../sites.ts";
import type { AloneConfig, AloneGate, AloneState, AloneStatus } from "./types.ts";

/** Kinds of tools it never covers: paying, signing in (the vault's secrets), the clipboard history. */
export const NEVER_ALONE_SCOPES: ReadonlySet<Scope> = new Set<Scope>(["pay", "signin", "clipboard"]);

/** Tools it never covers, whatever their kind: the ones that ask every time, and everything that touches a secret. */
export const NEVER_ALONE_TOOLS: ReadonlySet<string> = new Set<string>([
  ...ASKS_EVERY_TIME,
  "pay",
  "sign_in",
  "fill_code",
  "list_logins",
  "read_clipboard_history",
]);

/** The kinds the person may pick, in the consent sheet's order. */
export const ALONE_SCOPES: readonly Scope[] = SCOPES.map((scope) => scope.id).filter((scope) => !NEVER_ALONE_SCOPES.has(scope));

/** The fixed times, in minutes; a custom time is 1 minute to 8 hours. */
export const ALONE_MINUTES = [15, 60, 240] as const;
export const ALONE_MIN_MINUTES = 1;
export const ALONE_MAX_MINUTES = 480;
export const ALONE_MAX_SITES = 50;

/** "15 minutes", "1 hour", "4 hours", "1 hour 30 minutes". */
export function minutesWords(minutes: number): string {
  const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
  const h = hours === 0 ? "" : hours === 1 ? "1 hour" : `${hours} hours`;
  const m = rest === 0 ? "" : rest === 1 ? "1 minute" : `${rest} minutes`;
  return [h, m].filter(Boolean).join(" ") || "0 minutes";
}

/** The custom field's text as minutes: a whole number from 1 to 480, else null. */
export function customMinutes(text: string): number | null {
  const words = text.trim();
  if (!/^\d{1,3}$/.test(words)) return null;
  const minutes = Number(words);
  return minutes >= ALONE_MIN_MINUTES && minutes <= ALONE_MAX_MINUTES ? minutes : null;
}

/**
 * What was picked, made safe: the kinds it can never cover are dropped (not
 * refused: a pick is narrowed, never widened), sites are read as a person
 * types them, the time is checked. A problem, in words, when nothing is left
 * to allow or the time is no time.
 */
export function cleanConfig(config: {
  scopes: readonly unknown[];
  sites: readonly unknown[];
  minutes: unknown;
  throughLock?: unknown;
}): AloneConfig | { problem: string } {
  const scopes = [...new Set(config.scopes.filter(isScope).filter((scope) => !NEVER_ALONE_SCOPES.has(scope)))];
  const sites = [...new Set(config.sites.flatMap((site) => (typeof site === "string" ? [siteFromInput(site)] : [])).flatMap((site) => (site ? [site] : [])))];
  const { minutes } = config;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < ALONE_MIN_MINUTES || minutes > ALONE_MAX_MINUTES) {
    return { problem: `Pick a time from ${ALONE_MIN_MINUTES} minute to ${ALONE_MAX_MINUTES / 60} hours.` };
  }
  if (scopes.length === 0) return { problem: "Pick at least one thing agents may do." };
  return { scopes, sites: sites.slice(0, ALONE_MAX_SITES), minutes, throughLock: config.throughLock === true };
}

/** Whether it is on at `now`: on, and its time not up (the timer may be late after a sleep). */
export function running(state: AloneState, now: number): state is Extract<AloneState, { on: true }> {
  return state.on && now < state.ends;
}

/** Whether `tool`, which needs `scope`, runs without asking at `now`. */
export function coversTool(state: AloneState, tool: string, scope: Scope, now: number): boolean {
  if (!running(state, now)) return false;
  if (NEVER_ALONE_TOOLS.has(tool) || NEVER_ALONE_SCOPES.has(scope)) return false;
  return state.scopes.includes(scope);
}

/** Whether `site` is used without asking at `now`: "Use websites" was picked, and the site or one above it. */
export function coversSite(state: AloneState, site: string, now: number): boolean {
  return running(state, now) && state.scopes.includes("web") && state.sites.some((allowed) => siteCovers(allowed, site));
}

/**
 * What the pane starts with, from what the person already allowed: every
 * kind some agent has for good (never the ones above), the sites on their
 * own list and the ones agents were always allowed, one hour, and ending at
 * the lock.
 */
export function aloneDefaults(entries: readonly Pick<GrantEntry, "scopes">[], sites: readonly string[]): AloneConfig {
  const allowed = new Set(entries.flatMap((entry) => entry.scopes));
  return {
    scopes: ALONE_SCOPES.filter((scope) => allowed.has(scope)),
    sites: [...new Set(sites)].slice(0, ALONE_MAX_SITES),
    minutes: 60,
    throughLock: false,
  };
}

/** What an agent is told while it is off. */
export const NOT_ALONE: AloneStatus = { on: false, secondsLeft: 0, scopes: [], sites: [] };

/** A call finished: it goes in Work alone's record, with whether it ran without asking (`free`) and how it went. */
export function noteCall(
  alone: AloneGate | undefined,
  call: { agent: string; tool: string; sites: Iterable<string>; free: boolean },
  aborted: boolean,
  failed: boolean,
): void {
  alone?.note({ agent: call.agent, tool: call.tool, sites: [...call.sites], outcome: aborted ? "cancelled" : failed ? "error" : "ok", free: call.free });
}
