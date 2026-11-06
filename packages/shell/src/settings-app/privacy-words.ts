/**
 * Settings › Privacy & Security in words: since when a permission was given,
 * what an app or a program is called, and each agent's permissions in the
 * order of what they risk. Pure, so the pane only draws.
 */

import { basename } from "node:path";
import { type GrantEntry, label, type Scope } from "../agents/consent.ts";
import { describeAgentKey } from "./agent-names.ts";

/** Riskiest first: signing in and acting for you before reading. Scopes not listed (never kept) come last. */
const RISK: readonly Scope[] = [
  "signin",
  "pay",
  "act",
  "screen",
  "settings",
  "files",
  "clipboard",
  "notes_write",
  "calendar_write",
  "see",
  "notes",
  "calendar",
  "notifications",
];

const riskOf = (scope: Scope): number => {
  const index = RISK.indexOf(scope);
  return index < 0 ? RISK.length : index;
};

/** "Since Nov 3", with the year when it isn't this one; undefined when the date isn't known. */
export function sinceWords(since: number | null | undefined, now: Date, locale = "en-US"): string | undefined {
  if (!since) return undefined;
  const date = new Date(since * 1000);
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" };
  return `Since ${new Intl.DateTimeFormat(locale, options).format(date)}`;
}

/** "Last used Nov 3" (the location's), undefined when not known. */
export function lastUsedWords(time: number | null, now: Date, locale = "en-US"): string | undefined {
  const words = sinceWords(time, now, locale);
  return words ? words.replace(/^Since/, "Last used") : undefined;
}

/** The words after a permission: since when, and when last used where known. */
export const grantDetail = (parts: ReadonlyArray<string | undefined>): string | undefined => {
  const shown = parts.filter((part): part is string => part !== undefined);
  return shown.length > 0 ? shown.join(" · ") : undefined;
};

/** An app as the person knows it: its installed name; an app outside Flatpak has no id of its own. */
export function appTitle(app: string, installed?: (id: string) => { name: string } | undefined): string {
  if (app === "") return "Apps outside Flatpak";
  return installed?.(app)?.name ?? app;
}

/** A program on the screen-sharing list: its installed name, else its file's name. */
export function programTitle(path: string, installed?: (id: string) => { name: string } | undefined): string {
  const file = basename(path);
  return installed?.(file)?.name ?? file;
}

export interface AgentPermissions {
  key: string;
  title: string;
  detail: string;
  scopes: Array<{ scope: Scope; label: string; since: number | null }>;
}

/** Each agent with what it was allowed for good, by name; its permissions riskiest first. */
export function agentPermissions(entries: readonly GrantEntry[], home: string): AgentPermissions[] {
  return entries
    .filter((entry) => entry.scopes.length > 0)
    .map((entry) => {
      const name = describeAgentKey(entry.key, home);
      const scopes = [...entry.scopes]
        .sort((a, b) => riskOf(a) - riskOf(b))
        .map((scope) => ({ scope, label: label(scope), since: entry.since[scope] ?? null }));
      return { key: entry.key, title: name.title, detail: name.detail, scopes };
    })
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}
