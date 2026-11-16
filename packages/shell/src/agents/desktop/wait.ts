/**
 * Carrying out wait_for (tools/lib/wait.ts). A page's wait goes to Dashi's
 * extension, which watches the page itself (browser-extension/src/background/
 * wait.ts); the shell only relays it. A window's title is looked for on every
 * compositor event and, since a title can change without one, every 250 ms
 * here in the shell: never by the model. A file is watched in its folder.
 */

import { watch } from "node:fs";
import { lstat } from "node:fs/promises";
import { placeForAgent } from "../../shared/files/index.ts";
import { type RunContext, type ToolResult, text, toolError } from "../context.ts";
import type { Call, WaitUntil } from "../tools/index.ts";
import { onPage } from "./browser.ts";
import { currentPolicy } from "./files.ts";

type WaitCall = Extract<Call, { name: "wait_for" }>;

/** How often a window's title is looked at again between compositor events. */
const TITLE_MS = 250;
/** How often a file's folder is looked at again, should a watch miss it (a removable drive). */
const FILE_MS = 500;

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

/** What was waited for, in words: "“Loading” to go". */
export function waitWords(until: WaitUntil): string {
  if ("text" in until) return `“${until.text}” to appear`;
  if ("textGone" in until) return `“${until.textGone}” to go`;
  if ("ref" in until) return `element [${until.ref}] to be ${until.state}`;
  if ("page" in until) return until.page === "loaded" ? "the page to load" : "the page to stop changing";
  if ("window" in until) return `a window titled “${until.window}”`;
  return "the file";
}

/** The answer: met or not, in words and fields. */
export function waitAnswer(until: WaitUntil, met: boolean, ms: number, extra: Record<string, unknown> = {}): ToolResult {
  const detail = typeof extra.detail === "string" ? extra.detail : "";
  const head = met ? `Done waiting for ${waitWords(until)}: after ${seconds(ms)}.` : `Waited ${seconds(ms)} for ${waitWords(until)}; it didn't happen.`;
  const tail = met && detail && "text" in until ? ` It is in: “${detail}”.` : !met && detail ? ` Now: ${detail}.` : "";
  return text(`${head}${tail}`, { met, ms, ...extra });
}

function pageWait(until: WaitUntil): Record<string, unknown> {
  if ("text" in until) return { kind: "text", text: until.text };
  if ("textGone" in until) return { kind: "text-gone", text: until.textGone };
  if ("ref" in until) return { kind: "element", ref: until.ref, state: until.state };
  return "page" in until && until.page === "quiet" ? { kind: "quiet", quietMs: 500 } : { kind: "loaded" };
}

async function waitOnPage(call: WaitCall, ctx: RunContext): Promise<ToolResult> {
  return onPage(ctx, call.tab, "Waiting on", async (link, tab) => {
    const timeoutMs = Math.round(call.seconds * 1000);
    const result = await link.ask("wait", { tab: tab.id, ...pageWait(call.until), timeoutMs }, timeoutMs + 5000);
    const ms = typeof result.ms === "number" ? result.ms : 0;
    const extra: Record<string, unknown> = { tab: `t${tab.id}` };
    if (typeof result.detail === "string") extra.detail = result.detail;
    if (result.gone === true) extra.detail = "that number is from a page that has gone";
    return waitAnswer(call.until, result.met === true, ms, extra);
  });
}

/** Until `found()` is true or `ms` pass, checking on `wake` and every `every` ms. */
export function until(
  found: () => Promise<boolean>,
  ms: number,
  every: number,
  wake: (again: () => void) => () => void,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    let busy = false;
    let done = false;
    const check = async () => {
      if (busy || done) return;
      busy = true;
      const yes = await found().catch(() => false);
      busy = false;
      if (yes) end(true);
    };
    const timer = setInterval(() => void check(), every);
    const deadline = setTimeout(() => end(false), ms);
    const stop = wake(() => void check());
    const abort = () => end(false);
    signal.addEventListener("abort", abort, { once: true });
    function end(result: boolean) {
      if (done) return;
      done = true;
      clearInterval(timer);
      clearTimeout(deadline);
      stop();
      signal.removeEventListener("abort", abort);
      resolve(result);
    }
    void check();
  });
}

async function waitForWindow(call: WaitCall, wanted: string, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Waiting for a window");
  const needle = wanted.toLowerCase();
  let id: number | null = null;
  const started = Date.now();
  const found = async () => {
    const match = (await ctx.compositor.windows()).find((window) => window.title.toLowerCase().includes(needle));
    id = match?.id ?? null;
    return match !== undefined;
  };
  const met = await until(found, call.seconds * 1000, TITLE_MS, (again) => ctx.compositor.on(again), ctx.signal);
  return waitAnswer(call.until, met, Date.now() - started, met && id !== null ? { window: `w${id}` } : {});
}

async function waitForFile(call: WaitCall, path: string, ctx: RunContext): Promise<ToolResult> {
  const place = await placeForAgent(path, currentPolicy());
  if (!place.ok) return toolError(place.error);
  ctx.status("Waiting for a file");
  const started = Date.now();
  const folder = place.path.slice(0, place.path.lastIndexOf("/")) || "/";
  const wake = (again: () => void) => {
    try {
      const watcher = watch(folder, () => again());
      return () => watcher.close();
    } catch {
      return () => {};
    }
  };
  const met = await until(async () => (await lstat(place.path).catch(() => null)) !== null, call.seconds * 1000, FILE_MS, wake, ctx.signal);
  return waitAnswer(call.until, met, Date.now() - started, { path: place.path });
}

export async function waitFor(call: WaitCall, ctx: RunContext): Promise<ToolResult> {
  if ("window" in call.until) return waitForWindow(call, call.until.window, ctx);
  if ("file" in call.until) return waitForFile(call, call.until.file, ctx);
  return waitOnPage(call, ctx);
}
