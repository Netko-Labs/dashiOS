/**
 * Carrying out list_logins, sign_in, fill_code, pay and hand_over
 * (tools/secrets.ts): the broker (secrets/broker.ts, secrets/pay.ts) does
 * the signing in and the paying; this finds the window, checks the agent is
 * in Dashi's sandbox, and gives the broker its hands and eyes.
 */

import { closeSync, openSync, readSync } from "node:fs";
import type { CompositorWindow } from "../../compositor.ts";
import { fieldAt, focusedField, limits, type Placed, type Rect, toWindow } from "../atspi/tree.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";
import { type BrokerContext, fillCode, signIn } from "../secrets/broker.ts";
import { payWith } from "../secrets/pay.ts";
import { describeForAgent, findLogins, SOURCE_LABELS } from "../secrets/sources.ts";
import { named, noWindow, subject } from "../subject.ts";
import type { Call } from "../tools/index.ts";

/** How long a browser just woken (Atspi.wake) takes to publish its page: about a second in the VM's Helium. */
const WOKEN_MS = 1200;

/** A field as the app placed it, in the window's content points (what the mask takes). */
function placeIn(window: CompositorWindow, field: Placed): Rect | null {
  if (!field.rect) return null;
  const frame = window.frame ?? { width: 0, height: 0 };
  return toWindow(field.rect, field.page, { width: frame.width, height: frame.height - window.titleBar });
}

/** What an agent outside the sandbox is told. */
export const UNCONFINED =
  "Signing in needs you to run in Dashi's agent sandbox, where you can use the person's logins but not read them any other way. " +
  "The person can start you with `dashi-agent <your command>`. Until then, use hand_over to ask them.";

/** A process's arguments, from /proc (null when they can't be read). */
export function cmdlineOf(pid: number): string[] | null {
  let fd: number | null = null;
  try {
    fd = openSync(`/proc/${pid}/cmdline`, "r");
    const buffer = new Uint8Array(64 * 1024);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    if (length === 0) return null;
    return new TextDecoder()
      .decode(buffer.subarray(0, length))
      .split("\0")
      .filter((arg) => arg !== "");
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export async function listLogins(call: Extract<Call, { name: "list_logins" }>, ctx: RunContext): Promise<ToolResult> {
  ctx.status(call.site ? `Looking for logins for ${call.site}` : "Looking at saved logins");
  const sources = ctx.secrets.sources();
  if (sources.length === 0) return toolError("No password source is turned on (Settings › Passwords).");
  const { logins, failed } = await findLogins(sources, call.site ?? "");
  const note = failed.length > 0 ? `${failed.map((id) => SOURCE_LABELS[id]).join(" and ")} couldn't be asked.` : null;
  return json({ logins: logins.map(describeForAgent), ...(note ? { note } : {}) });
}

function brokerFor(window: CompositorWindow, ctx: RunContext): BrokerContext {
  return {
    sources: ctx.secrets.sources(),
    inspect: async () => {
      const cmdline = window.pid !== null ? cmdlineOf(window.pid) : null;
      const atspi = await ctx.secrets.atspi();
      const pid = window.pid;
      if (pid === null || !atspi) return { focused: null, cmdline };
      const look = async () => {
        // What the last focus event named, walked up for its documents; else a search of the tree.
        const leaf = await atspi.focusedIn(pid).catch(() => null);
        const focused = leaf ? await fieldAt(leaf).catch(() => null) : null;
        if (focused) return focused;
        const app = await atspi.appFor(pid).catch(() => null);
        return app ? await focusedField(app, limits(1500, 8000)) : null;
      };
      // Chromium publishes its pages only once asked (Atspi.wake): wake it, and once more if the page still says nothing.
      if (await atspi.wake?.(pid).catch(() => false)) await Bun.sleep(WOKEN_MS);
      const focused = await look();
      if (focused || !(await atspi.wake?.(pid, true).catch(() => false))) return { focused, cmdline };
      await Bun.sleep(WOKEN_MS);
      return { focused: await look(), cmdline };
    },
    type: (payload) => ctx.hands.send(window, payload, ctx.agent, ctx.status),
    ask: (summary, logins) => ctx.secrets.ask(summary, logins),
    approvals: ctx.secrets.approvals,
    filled: (field) => ctx.secrets.filled(window.id, placeIn(window, field), field.again),
    cancelled: () => ctx.signal.aborted,
    exclusive: (work) => ctx.secrets.exclusive(work),
    status: ctx.status,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export async function signInCall(call: Extract<Call, { name: "sign_in" | "fill_code" }>, ctx: RunContext): Promise<ToolResult> {
  if (!ctx.secrets.confined) return toolError(UNCONFINED);
  const window = await named(ctx.compositor, call.window);
  if (!window) return noWindow(call.window);
  if (window.pid === null) return toolError("Dashi can't tell which app that window belongs to, so it won't fill anything into it.");
  const broker = brokerFor(window, ctx);
  if (broker.sources.length === 0) return toolError("No password source is turned on (Settings › Passwords).");
  return call.name === "sign_in" ? signIn(broker, call.site, call.account, call.submit) : fillCode(broker, call.site, call.account, call.submit);
}

export async function handOver(call: Extract<Call, { name: "hand_over" }>, ctx: RunContext): Promise<ToolResult> {
  const window = await named(ctx.compositor, call.window);
  if (!window) return noWindow(call.window);
  ctx.status(`Waiting for you: ${call.reason}`);
  // The window comes forward for the person; the agent can't see it until Done.
  await ctx.compositor.request("focus", { window: window.id }).catch(() => {});
  const done = await ctx.secrets.handOver(window.id, call.reason);
  if (!done) return toolError(`The person didn't press Done (the turn was taken down). Ask them before going on with ${subject(window, ctx)}.`);
  return text(`The person pressed Done: ${subject(window, ctx)} is yours again. Take a screenshot to see where things are.`);
}

export async function payCall(call: Extract<Call, { name: "pay" }>, ctx: RunContext): Promise<ToolResult> {
  if (!ctx.secrets.confined) return toolError(UNCONFINED);
  const window = await named(ctx.compositor, call.window);
  if (!window) return noWindow(call.window);
  if (window.pid === null) return toolError("Dashi can't tell which app that window belongs to, so it won't fill anything into it.");
  const broker = brokerFor(window, ctx);
  const pay = {
    ...broker,
    cards: () => ctx.secrets.vault.cards(),
    pay: (merchant: string, cents: number, card: number) => ctx.secrets.vault.pay(merchant, cents, card),
    filled: (field: Placed) => ctx.secrets.filled(window.id, placeIn(window, field), field.again),
  };
  return payWith(pay, call.site, call.cents, call.card);
}
