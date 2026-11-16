/**
 * Waiting on a native window's tree: the seam `wait_for` (v09/reach, docs/
 * actions.md "Native windows") calls with a window. Woken by the app's own
 * tree events (Atspi.watchChanges), checked again on each, and at most every
 * CHECK_MS without one; never a loop on the model's side.
 */

import type { RunContext } from "../context.ts";
import { readNode } from "./lib/bus.ts";
import { locate } from "./lib/locate.ts";
import { has, S } from "./lib/roles.ts";
import { mark, settle } from "./lib/settle.ts";
import { isResult, target } from "./lib/target.ts";
import { named } from "./lib/windows.ts";
import { readTree } from "./read.ts";
import type { Element } from "./types.ts";

/** What to wait for in a window: words shown (or gone), an element there, enabled or gone, or the tree idle. */
export type WindowUntil = { text: string; gone?: boolean } | { ref: number; state: "there" | "enabled" | "gone" } | { idle: true };

export interface WindowWaited {
  met: boolean;
  ms: number;
  /** What happened, in words a model reads: "“Saved” appeared", "[12] is enabled". */
  detail: string;
}

/** Checked again at least this often when the app sends no events. */
const CHECK_MS = 250;
/** Quiet this long is idle. */
const IDLE_MS = 300;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function holds(root: Element, words: string): boolean {
  const want = words.toLowerCase();
  const visit = (element: Element): boolean =>
    `${element.name}\n${element.text ?? ""}\n${element.value?.text ?? ""}`.toLowerCase().includes(want) || element.children.some(visit);
  return visit(root);
}

async function check(window: number, until: WindowUntil, ctx: RunContext): Promise<string | null> {
  const trees = ctx.trees;
  if (!trees) return null;
  if ("text" in until) {
    const shown = await named(ctx, window);
    if (!shown) return null;
    const tree = await readTree(trees, shown);
    if (typeof tree === "string") return null;
    const there = holds(tree.root, until.text);
    return there !== (until.gone === true) ? `“${until.text}” ${until.gone ? "is gone" : "appeared"}` : null;
  }
  if ("ref" in until) {
    const t = await target(until.ref, window, ctx);
    if (isResult(t)) return until.state === "gone" ? `[${until.ref}] is gone` : null;
    const now = await readNode(t.node);
    if (until.state === "there") return now ? `[${until.ref}] is there` : null;
    if (until.state === "enabled") return now && (has(now.states, S.ENABLED) || has(now.states, S.SENSITIVE)) ? `[${until.ref}] is enabled` : null;
    return now ? null : `[${until.ref}] is gone`;
  }
  return null;
}

/** Wait in `window` until `until` holds, at most `timeoutMs`. */
export async function waitOnWindow(window: number, until: WindowUntil, timeoutMs: number, ctx: RunContext): Promise<WindowWaited> {
  const started = Date.now();
  const trees = ctx.trees;
  const shown = await named(ctx, window);
  if (!trees || !shown) return { met: false, ms: 0, detail: shown ? "Windows can't be read as elements here." : `There is no window w${window}.` };
  const bus = await trees.bus();
  const where = await locate(bus, shown);
  if (!bus || "none" in where) return { met: false, ms: Date.now() - started, detail: `w${window}'s tree can't be read; wait with a screenshot instead.` };
  await bus.watchChanges?.();
  if ("idle" in until) {
    const from = mark(bus, where.app);
    await settle(bus, where.app, from, timeoutMs);
    const quiet = Date.now() - (bus.changesOf?.(where.app).at ?? 0) >= IDLE_MS;
    return { met: quiet, ms: Date.now() - started, detail: quiet ? `w${window} is idle` : `w${window} kept changing` };
  }
  while (Date.now() - started < timeoutMs && !ctx.signal.aborted) {
    const met = await check(window, until, ctx);
    if (met) return { met: true, ms: Date.now() - started, detail: met };
    const from = mark(bus, where.app);
    const deadline = Math.min(CHECK_MS, timeoutMs - (Date.now() - started));
    for (let waited = 0; waited < deadline && mark(bus, where.app) === from; waited += 25) await sleep(25);
  }
  return { met: false, ms: Date.now() - started, detail: "It did not happen in time." };
}
