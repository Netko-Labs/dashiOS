/**
 * The first use (decisions.md D148): one sheet, once, naming what Dashi's
 * assistant may see and do on this computer. "Always Allow" keeps it;
 * "Don't ask for these again" (Settings › Agents) never shows it. After
 * it, the person's voice is the consent, and the exceptions are the
 * registry's (session-assistant.ts).
 */

import { choices, isScope, kept, SCOPES, type Scope } from "../../consent.ts";
import type { AssistantOptions } from "../types.ts";

/** What the grants kept for Dashi's own assistant are kept under. */
export const ASSISTANT_KEY = "dashi-assistant";
/** The sheet queue's id for this sheet (agents' connections count from 1, the person's own questions are 0). */
const ASSISTANT_SHEETS = -1;
const ALL_SCOPES: readonly Scope[] = SCOPES.map((scope) => scope.id);

/** The scopes the assistant holds; null when the person said no. */
export async function firstUse(options: Pick<AssistantOptions, "agents" | "ui" | "settings" | "name">, signal: AbortSignal): Promise<Set<Scope> | null> {
  const agents = options.agents();
  const ui = options.ui();
  if (options.settings().agents.skipGrants === true || !ui || !agents) return new Set(ALL_SCOPES);
  // Kept by "Always Allow". Paying and the clipboard history are never kept: they ask every time themselves.
  const stored = agents.grants.get(ASSISTANT_KEY);
  if (stored.size > 0) return new Set<Scope>([...stored, "pay", "clipboard"]);
  const name = options.name();
  const who = { name, detail: "When you ask by voice, it does what you say with these. What is in front goes with your words.", claims: null, remote: false };
  const title = `Let ${name} see and use this computer?`;
  const answer = await ui.ask({ agent: ASSISTANT_SHEETS, who, scopes: choices(new Set(ALL_SCOPES), new Set()), title }, signal);
  if (answer.allow === "deny" || signal.aborted) return null;
  const allowed = new Set(answer.scopes.filter(isScope));
  if (answer.allow === "always") agents.grants.set(ASSISTANT_KEY, kept(new Set(), [...allowed], new Set()));
  return allowed;
}
