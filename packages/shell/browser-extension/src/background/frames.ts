/**
 * The content script in a tab's frames, and a tab's loads. A tab that was
 * open before the extension came (its pages have no content script) gets it
 * injected on first use. Loads are waited for by the browser's own events
 * (webNavigation), never by a guessed time.
 */

import { RefTable } from "../page/refs.ts";

/** Each tab's element numbers; a new page in the tab starts again. */
export const tables = new Map<number, RefTable>();

export function tableOf(tab: number): RefTable {
  let table = tables.get(tab);
  if (!table) {
    table = new RefTable();
    tables.set(tab, table);
  }
  return table;
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) tables.delete(details.tabId);
});
chrome.tabs.onRemoved.addListener((tab) => tables.delete(tab));

type Reply = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };

const isReply = (value: unknown): value is Reply => typeof value === "object" && value !== null && "ok" in value;

/** Ask the content script in one frame; injected first if the frame has none. */
export async function ask(tab: number, frameId: number, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  let reply: unknown;
  try {
    reply = await chrome.tabs.sendMessage(tab, message, { frameId });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab, frameIds: [frameId] }, files: ["content.js"] }).catch(() => []);
    try {
      reply = await chrome.tabs.sendMessage(tab, message, { frameId });
    } catch {
      throw new Error("Dashi can't reach that page (a browser page, the store, or one still starting).");
    }
  }
  if (!isReply(reply)) throw new Error("The page didn't answer.");
  if (!reply.ok) throw new Error(reply.error);
  return reply.result;
}

/** The tab's frames, the page first. */
export async function framesOf(tab: number): Promise<chrome.webNavigation.Frame[]> {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId: tab })) ?? [];
  return frames.filter((frame) => !frame.errorOccurred).sort((a, b) => (a.frameId === 0 ? -1 : b.frameId === 0 ? 1 : a.frameId - b.frameId));
}

/** The addresses of a frame's document and of each document around it, innermost first. */
export function documentsOf(frames: readonly chrome.webNavigation.Frame[], frameId: number): string[] {
  const byId = new Map(frames.map((frame) => [frame.frameId, frame]));
  const out: string[] = [];
  let current = byId.get(frameId);
  for (let depth = 0; current && depth < 64; depth++) {
    out.push(current.url);
    current = current.parentFrameId >= 0 ? byId.get(current.parentFrameId) : undefined;
  }
  return out;
}

export interface Load {
  loaded: boolean;
  url?: string;
  error?: string;
}

/**
 * Until the tab's page has loaded (or failed), or the page changed in place
 * (a history push, an anchor). `started` resolves when a load begins, so a
 * click can tell whether it led anywhere.
 */
export function watchLoad(tab: number, timeoutMs: number): { done: Promise<Load>; started: Promise<boolean>; cancel(): void } {
  let finish: (load: Load) => void = () => {};
  let begin: (yes: boolean) => void = () => {};
  const started = new Promise<boolean>((resolve) => {
    begin = resolve;
  });
  const done = new Promise<Load>((resolve) => {
    finish = resolve;
  });
  const mine = (details: chrome.webNavigation.Details) => details.tabId === tab && details.frameId === 0;
  const onBefore = (details: chrome.webNavigation.Details) => {
    if (mine(details)) begin(true);
  };
  const onDone = (details: chrome.webNavigation.Details) => {
    if (mine(details)) end({ loaded: true, url: details.url });
  };
  const onError = (details: chrome.webNavigation.Details & { error: string }) => {
    // An aborted load is one another replaced; the next one ends this wait.
    if (mine(details) && details.error !== "net::ERR_ABORTED") end({ loaded: false, url: details.url, error: details.error });
  };
  const onInPlace = (details: chrome.webNavigation.Details) => {
    if (mine(details)) {
      begin(true);
      end({ loaded: true, url: details.url });
    }
  };
  const timer = setTimeout(() => end({ loaded: false, error: "still loading" }), timeoutMs);
  function end(load: Load) {
    clearTimeout(timer);
    chrome.webNavigation.onBeforeNavigate.removeListener(onBefore);
    chrome.webNavigation.onCompleted.removeListener(onDone);
    chrome.webNavigation.onErrorOccurred.removeListener(onError);
    chrome.webNavigation.onHistoryStateUpdated.removeListener(onInPlace);
    chrome.webNavigation.onReferenceFragmentUpdated.removeListener(onInPlace);
    begin(false);
    finish(load);
  }
  chrome.webNavigation.onBeforeNavigate.addListener(onBefore);
  chrome.webNavigation.onCompleted.addListener(onDone);
  chrome.webNavigation.onErrorOccurred.addListener(onError);
  chrome.webNavigation.onHistoryStateUpdated.addListener(onInPlace);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(onInPlace);
  return { done, started, cancel: () => end({ loaded: false }) };
}
