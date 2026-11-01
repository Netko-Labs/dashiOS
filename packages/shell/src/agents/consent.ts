/**
 * What an agent may do (scopes), answers kept for next time ("Always
 * Allow"), and the activity log. Both files live in
 * `$XDG_STATE_HOME/dashi/agents/`: grants.json, keyed by the agent's
 * executable (or `ssh:<name>` over SSH), and activity.jsonl, one line per
 * call without its arguments, text, or images.
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
    detail: "Open apps; bring forward, arrange, minimize, or close windows; choose items in their menus; click and type in them with its own pointer and keyboard; lock the screen. Force quitting an app always asks you first",
  },
  { id: "notifications", label: "See notifications", detail: "Read your recent notifications, and dismiss them" },
  {
    id: "files",
    label: "Browse your files",
    detail: "List and search your folders by name (your home folder and removable drives, not folders that hold secrets), and open files in their apps. Moving a file to the Trash always asks you first. It can't read, change, or delete the files",
  },
  { id: "notes", label: "Read your notes", detail: "List, search, and read your notes" },
  { id: "notes_write", label: "Add to your notes", detail: "Create notes, and add lines to the end of them" },
  { id: "calendar", label: "Read your calendar", detail: "List your calendars and the events in them: their titles, times, places, and notes" },
  { id: "calendar_write", label: "Add to your calendar", detail: "Add events to your calendar (it can't change or delete the ones there)" },
  {
    id: "settings",
    label: "Change settings",
    detail: "Dark Mode, Do Not Disturb, window corners, screen scaling, Wi-Fi, the time zone, 24-hour time, region formats, the sound output and volume, the power mode, and the menu bar's battery percentage and speaker: it can read them (with your network, Bluetooth, power, and account details), join networks and connect Bluetooth devices you have used before. It never gets a password",
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
  return new Set([...stored, ...ticked.filter((scope) => !sessionOnly.has(scope))]);
}

function stateDir(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local/state");
  return join(base, "dashi/agents");
}

/** Something changed in the kept answers: an agent's were replaced, or forgotten. */
export interface GrantChange {
  key: string;
  removed: boolean;
}

/** Answers kept across connections. */
export class Grants {
  private readonly path = join(stateDir(), "grants.json");
  private readonly byAgent = new Map<string, Set<Scope>>();
  private readonly listeners = new Set<(change: GrantChange) => void>();

  constructor() {
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      const agents = typeof value === "object" && value !== null ? (value as Record<string, unknown>).agents : null;
      if (typeof agents === "object" && agents !== null) {
        for (const [key, scopes] of Object.entries(agents)) {
          if (Array.isArray(scopes)) this.byAgent.set(key, new Set(scopes.filter(isScope)));
        }
      }
    } catch {
      // No grants yet (or an unreadable file): everyone is asked.
    }
  }

  get(key: string): Set<Scope> {
    return new Set(this.byAgent.get(key));
  }

  /** Every agent with kept answers, for System Settings. */
  entries(): Array<{ key: string; scopes: Scope[] }> {
    return [...this.byAgent].map(([key, scopes]) => ({ key, scopes: [...scopes] }));
  }

  set(key: string, scopes: ReadonlySet<Scope>): void {
    this.byAgent.set(key, new Set(scopes));
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

  onChange(listener: (change: GrantChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(change: GrantChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private save(): void {
    const agents = Object.fromEntries([...this.byAgent].map(([agent, granted]) => [agent, [...granted]]));
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify({ version: 1, agents }));
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
