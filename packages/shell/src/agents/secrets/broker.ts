/**
 * The broker: signs an agent in, or enters a one-time code, without the
 * agent ever holding the secret (docs/secrets.md, "Signing in"). It finds the
 * logins for the site in every enabled source, asks the person which one (and
 * whether for this use or the whole task), checks the field and the page, then
 * types the secret with the agent's hands and drops it. Nothing it returns,
 * logs, or shows in the menu bar holds a secret.
 */

import type { Placed } from "../atspi/tree.ts";
import { type ToolResult, text, toolError } from "../context.ts";
import { checkField, type FieldInfo } from "./field-check.ts";
import { findLogins, type Login, type LoginSource, loginKey, SOURCE_LABELS } from "./sources.ts";

/** An "Allow Once" covers the sign-in it was for, and that login's code, this long. */
export const ONCE_MS = 120_000;
/** How long after Tab before the next field is checked. */
const SETTLE_MS = 200;

export interface Approval {
  /** Until when (ms); Infinity for "Allow for This Task". */
  until: number;
  /** "Allow Once": only that login's code may follow. */
  codeOnly: boolean;
}

export interface SignInAnswer {
  allow: "once" | "task" | "deny";
  login: string | null;
}

/** One shown login on the sheet. */
export interface SheetLogin {
  key: string;
  account: string;
  site: string;
  source: string;
}

export interface BrokerContext {
  /** Enabled sources. */
  sources: readonly LoginSource[];
  /** The focused field in the target window, and its browser's command line, now. */
  inspect(): Promise<FieldInfo>;
  /** Type into the target window with the agent's hands. */
  type(payload: Record<string, unknown>): Promise<void>;
  /** Ask the person; "<agent> wants to <summary>". */
  ask(summary: string, logins: readonly SheetLogin[]): Promise<SignInAnswer>;
  /** This connection's approvals, by login key. */
  approvals: Map<string, Approval>;
  /** A field a code was typed into (its window coordinates): agents' pictures blank it. */
  filled?(field: Placed): void;
  /** Whether the agent gave up on this call (then nothing is typed). */
  cancelled?(): boolean;
  /** Run the typing with this agent's other calls held. */
  exclusive?<T>(work: () => Promise<T>): Promise<T>;
  status(text: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
}

const never = (site: string) => `Dashi won't sign agents in to ${site}: the person marked that login "Never". Use hand_over to ask them to do it themselves.`;

/** The login to use, from an approval or the person's answer; else the tool's error. */
async function choose(ctx: BrokerContext, site: string, account: string | null, need: "password" | "code", summary: string): Promise<Login | ToolResult> {
  const { logins, failed } = await findLogins(ctx.sources, site);
  const candidates = logins.filter((l) => (account === null || l.account === account) && (need === "password" || l.hasCode));
  const usable = candidates.filter((l) => l.agents !== "never");
  if (usable.length === 0) {
    if (candidates.length > 0) return toolError(never(site));
    const missing = failed.length > 0 ? ` (${failed.map((s) => SOURCE_LABELS[s]).join(" and ")} couldn't be asked)` : "";
    const what = need === "code" ? "a login with a one-time code" : "a login";
    return toolError(`There is no ${what} for ${site}${account ? ` as ${account}` : ""}${missing}. Use hand_over to ask the person.`);
  }
  const now = ctx.now();
  for (const login of usable) {
    const approval = ctx.approvals.get(loginKey(login));
    if (approval && approval.until > now && (need === "code" || !approval.codeOnly)) return login;
  }
  const answer = await ctx.ask(
    summary,
    usable.map((l) => ({ key: loginKey(l), account: l.account, site: l.site, source: SOURCE_LABELS[l.source] })),
  );
  const login = usable.find((l) => loginKey(l) === answer.login);
  if (answer.allow === "deny" || !login) return toolError(`The person did not allow it. Don't try again unless they ask you to.`);
  ctx.approvals.set(loginKey(login), answer.allow === "task" ? { until: Number.POSITIVE_INFINITY, codeOnly: false } : { until: now + ONCE_MS, codeOnly: true });
  return login;
}

/** Type `secret` and forget it. */
async function typeSecret(ctx: BrokerContext, secret: Uint8Array): Promise<void> {
  const value = new TextDecoder().decode(secret);
  secret.fill(0);
  await ctx.type({ keys: [{ text: value }] });
}

const isResult = (value: Login | ToolResult): value is ToolResult => "content" in value;

/** What a call the agent gave up on answers (no one reads it), having typed nothing. */
export const GAVE_UP = "The call was given up on before anything was typed.";
const run = <T>(work: () => Promise<T>): Promise<T> => work();

export async function signIn(ctx: BrokerContext, site: string, account: string | null, submit: boolean): Promise<ToolResult> {
  // The page first: no sheet for a field Dashi won't fill anyway.
  const before = await ctx.inspect();
  const start = checkField(before, "code", site);
  if (!start.ok) return toolError(start.reason);
  const chosen = await choose(ctx, site, account, "password", `sign in to ${site}`);
  if (isResult(chosen)) return chosen;
  if (ctx.cancelled?.()) return toolError(GAVE_UP);
  return (ctx.exclusive ?? run)(() => typeLogin(ctx, chosen, site, submit));
}

/** The page checked again, then the account and the password typed (this agent's other calls held). */
async function typeLogin(ctx: BrokerContext, chosen: Login, site: string, submit: boolean): Promise<ToolResult> {
  ctx.status(`Signing in to ${site}`);
  let now = checkField(await ctx.inspect(), "code", site);
  if (!now.ok) return toolError(now.reason);
  if (now.focused.kind === "text") {
    // The account name is no secret: type it, then move to the password.
    await ctx.type({ keys: [{ text: chosen.account }, { name: "Tab" }] });
    await ctx.sleep(SETTLE_MS);
  }
  now = checkField(await ctx.inspect(), "password", site);
  if (!now.ok) return toolError(`${now.reason} Nothing secret was typed.`);
  const source = ctx.sources.find((s) => s.id === chosen.source);
  if (!source) return toolError("That login's source is turned off.");
  if (ctx.cancelled?.()) return toolError(GAVE_UP);
  await typeSecret(ctx, await source.password(chosen));
  if (submit) await ctx.type({ keys: [{ name: "Return" }] });
  return text(
    `Dashi typed the password for ${chosen.account} on ${site} (from ${SOURCE_LABELS[chosen.source]}); you never see it.${submit ? " It pressed Return." : ""} Take a screenshot to see what the page did.`,
    { site, account: chosen.account, source: SOURCE_LABELS[chosen.source], submitted: submit },
  );
}

export async function fillCode(ctx: BrokerContext, site: string, account: string | null, submit: boolean): Promise<ToolResult> {
  const before = checkField(await ctx.inspect(), "code", site);
  if (!before.ok) return toolError(before.reason);
  const chosen = await choose(ctx, site, account, "code", `enter a one-time code for ${site}`);
  if (isResult(chosen)) return chosen;
  if (ctx.cancelled?.()) return toolError(GAVE_UP);
  return (ctx.exclusive ?? run)(() => typeCode(ctx, chosen, site, submit));
}

async function typeCode(ctx: BrokerContext, chosen: Login, site: string, submit: boolean): Promise<ToolResult> {
  ctx.status(`Entering a code for ${site}`);
  const now = checkField(await ctx.inspect(), "code", site);
  if (!now.ok) return toolError(`${now.reason} No code was typed.`);
  const source = ctx.sources.find((s) => s.id === chosen.source);
  if (!source) return toolError("That login's source is turned off.");
  if (ctx.cancelled?.()) return toolError(GAVE_UP);
  const code = new TextEncoder().encode(await source.code(chosen));
  // A code field is no password field: blank it in agents' pictures before it holds the code.
  ctx.filled?.(now.focused);
  await typeSecret(ctx, code);
  if (submit) await ctx.type({ keys: [{ name: "Return" }] });
  return text(`Dashi entered the one-time code for ${chosen.account} on ${site}; you never see it.${submit ? " It pressed Return." : ""}`, {
    site,
    account: chosen.account,
    submitted: submit,
  });
}
