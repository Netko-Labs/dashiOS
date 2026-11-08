/**
 * What an agent may do (scopes), answers kept for next time ("Always
 * Allow"), and the activity log. Both files live in
 * `$XDG_STATE_HOME/dashi/agents/`: grants.json, keyed by the agent's
 * executable (or `ssh:<name>` over SSH), each scope with since when (taken
 * back one by one in Settings › Privacy & Security), and activity.jsonl, one
 * line per call without its arguments, text, or images.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ScopeChoice } from "./presence.ts";

export const SCOPES = [
  { id: "see", label: "See windows and apps", detail: "Window titles, app names, the apps installed, and your screens" },
  { id: "screen", label: "See the screen", detail: "Screenshots of the screen, an area of it, or one window" },
  {
    id: "act",
    label: "Manage windows and apps",
    detail:
      "Open apps; bring forward, arrange, minimize, or close windows; choose items in their menus; click and type in them with its own pointer and keyboard; lock the screen. Force quitting an app always asks you first",
  },
  {
    id: "web",
    label: "Use websites",
    detail:
      "Open pages in your browser, read them as text, and click, fill in and choose things on them, through Dashi's browser extension. You are asked about each site the first time. It never reads a password, card or code field",
  },
  { id: "notifications", label: "See notifications", detail: "Read your recent notifications, and dismiss them" },
  {
    id: "files",
    label: "Browse your files",
    detail:
      "List and search your folders by name (your home folder and removable drives, not folders that hold secrets), and open files in their apps. Moving a file to the Trash always asks you first. It can't read, change, or delete the files",
  },
  { id: "notes", label: "Read your notes", detail: "List, search, and read your notes" },
  { id: "notes_write", label: "Add to your notes", detail: "Create notes, and add lines to the end of them" },
  { id: "calendar", label: "Read your calendar", detail: "List your calendars and the events in them: their titles, times, places, and notes" },
  { id: "calendar_write", label: "Add to your calendar", detail: "Add events to your calendar (it can't change or delete the ones there)" },
  {
    id: "signin",
    label: "Sign in for you",
    detail:
      "See which sites you have logins for and their account names, and ask you to let Dashi sign it in or enter a one-time code. Each login is asked about on screen; Dashi types the password or code, and the agent never sees it",
  },
  {
    id: "pay",
    label: "Pay for you",
    detail:
      "Ask to pay a site with one of your saved cards, within your limits. Every payment asks for your fingerprint or password, and this permission is never kept: Always Allow doesn't cover it",
  },
  {
    id: "clipboard",
    label: "See your clipboard history",
    detail:
      "Read what you copied in the last 7 days, never the copies Dashi left out (password fields, password managers). You are asked every time, and Always Allow doesn't cover it",
  },
  {
    id: "settings",
    label: "Change settings",
    detail:
      "Dark Mode, Do Not Disturb, Night Shift, window corners, text and pointer size, motion, the Dock, the trackpad and mouse, screen scaling, Wi-Fi, the time zone, 24-hour time, region formats, the sound output and volume, the power mode, and what the menu bar shows: it can read them (with your network, Bluetooth, power, and account details), join networks and connect Bluetooth devices you have used before. It never gets a password",
  },
] as const;

export type Scope = (typeof SCOPES)[number]["id"];

export function isScope(value: unknown): value is Scope {
  return SCOPES.some((scope) => scope.id === value);
}

export function label(scope: Scope): string {
  return SCOPES.find((entry) => entry.id === scope)?.label ?? scope;
}

/** The sheet's rows: every scope, ticked if needed now or already allowed. */
export function choices(needs: ReadonlySet<Scope>, granted: ReadonlySet<Scope>): ScopeChoice[] {
  return SCOPES.map(({ id, label, detail }) => ({
    id,
    label,
    detail,
    checked: needs.has(id) || granted.has(id),
    needed: needs.has(id),
  }));
}

/**
 * What "Always Allow" writes down: what was kept already, plus the scopes the
 * person ticked, except those allowed only for this connection so far. The
 * sheet shows such a scope ticked (it is allowed), but ticking it is not
 * choosing "always"; an earlier "Allow Once" must not turn permanent here.
 */
export function kept(stored: ReadonlySet<Scope>, ticked: readonly Scope[], sessionOnly: ReadonlySet<Scope>): Set<Scope> {
  return new Set([...stored, ...ticked.filter((scope) => !sessionOnly.has(scope))].filter((scope) => !NEVER_KEPT.has(scope)));
}

/** Scopes "Always Allow" never keeps: allowed for the connection at most (paying, the clipboard history, which asks every time too). */
export const NEVER_KEPT: ReadonlySet<Scope> = new Set<Scope>(["pay", "clipboard"]);

/** Where the agents' files are: `$XDG_STATE_HOME/dashi/agents/`. */
export function stateDir(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local/state");
  return join(base, "dashi/agents");
}

/** Something changed in the kept answers: an agent's were replaced, one was taken back (`revoked`), or all were forgotten (`removed`). */
export interface GrantChange {
  key: string;
  removed: boolean;
  /** The scopes taken back one by one (Settings › Privacy & Security). */
  revoked?: readonly Scope[];
}

/** An agent's kept answers, each with since when (seconds; null when kept before Dashi wrote dates down). */
export interface GrantEntry {
  key: string;
  scopes: Scope[];
  since: Partial<Record<Scope, number | null>>;
}

/**
 * grants.json read: `{version: 2, agents: {key: {scope: since}}}`, or
 * version 1's `{agents: {key: [scope…]}}` (no dates). A kept "pay" or
 * "clipboard" (a file edited by hand) is not honored.
 */
export function parseGrants(value: unknown): Map<string, Map<Scope, number | null>> {
  const out = new Map<string, Map<Scope, number | null>>();
  const agents = typeof value === "object" && value !== null ? (value as Record<string, unknown>).agents : null;
  if (typeof agents !== "object" || agents === null) return out;
  for (const [key, kept] of Object.entries(agents)) {
    const scopes = new Map<Scope, number | null>();
    if (Array.isArray(kept)) {
      for (const scope of kept) if (isScope(scope) && !NEVER_KEPT.has(scope)) scopes.set(scope, null);
    } else if (typeof kept === "object" && kept !== null) {
      for (const [scope, since] of Object.entries(kept)) {
        if (isScope(scope) && !NEVER_KEPT.has(scope)) scopes.set(scope, typeof since === "number" && Number.isInteger(since) && since > 0 ? since : null);
      }
    } else continue;
    out.set(key, scopes);
  }
  return out;
}

/** Answers kept across connections. */
export class Grants {
  private readonly path: string;
  private readonly byAgent: Map<string, Map<Scope, number | null>>;
  private readonly listeners = new Set<(change: GrantChange) => void>();

  /** `path` null keeps them in memory only (tests). */
  constructor(path: string | null = join(stateDir(), "grants.json")) {
    this.path = path ?? "";
    let read: unknown = null;
    try {
      if (path) read = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // No grants yet (or an unreadable file): everyone is asked.
    }
    this.byAgent = parseGrants(read);
  }

  get(key: string): Set<Scope> {
    return new Set(this.byAgent.get(key)?.keys());
  }

  /** Every agent with kept answers, for System Settings. */
  entries(): GrantEntry[] {
    return [...this.byAgent].map(([key, scopes]) => ({ key, scopes: [...scopes.keys()], since: Object.fromEntries(scopes) }));
  }

  /** What an agent may do from now on; a scope it had keeps its date, a new one is dated now. */
  set(key: string, scopes: ReadonlySet<Scope>, now: number = Math.floor(Date.now() / 1000)): void {
    const before = this.byAgent.get(key);
    this.byAgent.set(key, new Map([...scopes].map((scope) => [scope, before?.has(scope) ? (before.get(scope) ?? null) : now])));
    this.save();
    this.notify({ key, removed: false });
  }

  /**
   * Forget what an agent was allowed for good ("Revoke" in Settings). The
   * listeners hear it, so a connection that is up now stops holding the answers.
   */
  remove(key: string): boolean {
    if (!this.byAgent.delete(key)) return false;
    this.save();
    this.notify({ key, removed: true });
    return true;
  }

  /** Take back one thing an agent was allowed; the rest stays. A connection that is up stops holding it too. */
  revoke(key: string, scope: Scope): boolean {
    const scopes = this.byAgent.get(key);
    if (!scopes?.delete(scope)) return false;
    if (scopes.size === 0) this.byAgent.delete(key);
    this.save();
    this.notify({ key, removed: false, revoked: [scope] });
    return true;
  }

  /**
   * Put back what was taken (Undo after Revoke in Settings › Agents): the
   * scopes `entry` held, with their dates, beside any given since. A
   * connection that is up now asks again; the next one has them.
   */
  restore(entry: GrantEntry): void {
    const scopes = new Map(this.byAgent.get(entry.key));
    for (const scope of entry.scopes) if (!NEVER_KEPT.has(scope)) scopes.set(scope, entry.since[scope] ?? null);
    if (scopes.size === 0) return;
    this.byAgent.set(entry.key, scopes);
    this.save();
    this.notify({ key: entry.key, removed: false });
  }

  onChange(listener: (change: GrantChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(change: GrantChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private save(): void {
    if (!this.path) return;
    const agents = Object.fromEntries([...this.byAgent].map(([agent, granted]) => [agent, Object.fromEntries(granted)]));
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify({ version: 2, agents }));
    } catch (error) {
      console.error("dashi-shell: could not save agent grants:", error);
    }
  }
}

export interface Activity {
  agent: string;
  claims: string | null;
  tool: string | null;
  outcome: string;
  /** The launcher's Ask a call was a step of (agents/ask/tasks.ts), so the history groups them. */
  task?: string;
}

export function logActivity(entry: Activity): void {
  const path = join(stateDir(), "activity.jsonl");
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ time: Math.floor(Date.now() / 1000), ...entry })}\n`);
  } catch (error) {
    console.error("dashi-shell: could not log agent activity:", error);
  }
}
