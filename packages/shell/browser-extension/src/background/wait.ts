/**
 * wait_for, in the browser: the page loading is waited for by the browser's
 * own events (webNavigation), and everything about the page's content by the
 * content script's MutationObserver (content/wait.ts). A page that navigates
 * while text is waited for is waited on again in its new document, until the
 * same deadline. Nothing here polls on a timer.
 */

import { ask, tableOf, watchLoad } from "./frames.ts";

type Params = Record<string, unknown>;

const MAX_MS = 60_000;

/** One wait in tab `tab`: `{met, ms, …}`, `met` false when the time ran out. */
export async function waitInTab(tab: number, params: Params): Promise<Record<string, unknown>> {
  const timeoutMs = Math.max(0, Math.min(typeof params.timeoutMs === "number" ? params.timeoutMs : 10_000, MAX_MS));
  const started = Date.now();
  const until = started + timeoutMs;
  const since = () => Date.now() - started;
  const kind = params.kind;
  if (kind === "loaded") {
    const now = await chrome.tabs.get(tab);
    if (now.status !== "loading") return { met: true, ms: 0, url: now.url ?? "" };
    const load = await watchLoad(tab, timeoutMs).done;
    return { met: load.loaded, ms: since(), ...(load.error ? { error: load.error } : {}) };
  }
  if (kind === "element") {
    const target = typeof params.ref === "number" ? tableOf(tab).target(params.ref) : null;
    if (!target) return { met: params.state === "gone", ms: 0, gone: true };
    const result = await ask(tab, target.frameId, { op: "wait", kind, doc: target.doc, ref: target.local, state: params.state, until });
    return { ...result, ms: since() };
  }
  // Text, or a quiet page: the page's own frame, again in each new document until the deadline.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6 && Date.now() < until; attempt++) {
    const now = await chrome.tabs.get(tab);
    if (now.status === "loading") await watchLoad(tab, until - Date.now()).done;
    try {
      const result = await ask(tab, 0, { op: "wait", kind, text: params.text, quietMs: params.quietMs, until });
      return { ...result, ms: since() };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError && Date.now() < until) throw lastError;
  return { met: false, ms: since() };
}
