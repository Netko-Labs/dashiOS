/**
 * The shell's requests, carried out (protocol: packages/shell/src/browser/
 * protocol.ts). Tabs are the browser's ids; element numbers are the tab's
 * (RefTable), each pointing at a frame's document and its own number there.
 */

import { parseChords } from "../page/keys.ts";
import { renumber } from "../page/refs.ts";
import { watchDownload } from "./downloads.ts";
import { ask, documentsOf, framesOf, tableOf, watchLoad } from "./frames.ts";
import { MORE_METHODS } from "./more-methods.ts";
import { outcomeInTab } from "./outcome.ts";
import { tabMethod } from "./tabs.ts";
import { idOf, info, type Params, tabOf, targetOf } from "./targets.ts";
import { waitInTab } from "./wait.ts";

type Method = (params: Params) => Promise<Record<string, unknown>>;

const LOAD_MS = 30_000;
/** How long a click waits for the file it started downloading to be whole. */
const DOWNLOAD_MS = 60_000;
/** After a click on a link or a submit button, how long a load has to begin; after another click, less. */
const MAY_NAVIGATE_MS = 1_000;
const CLICK_NAVIGATE_MS = 250;

async function onElement(params: Params, op: string, extra: Params = {}): Promise<{ tab: number; result: Record<string, unknown> }> {
  const tab = idOf(await tabOf(params));
  const target = await targetOf(tab, params.ref);
  const result = await ask(tab, target.frameId, { op, doc: target.doc, ref: target.local, ...extra });
  return { tab, result };
}

/** read_page's `main` and `items`: the page's own frame (frames are mostly ads and widgets), numbered as the tab's. */
async function readTop(id: number, mode: "main" | "items"): Promise<Record<string, unknown>> {
  const table = tableOf(id);
  const result = await ask(id, 0, { op: "read", mode });
  const doc = String(result.doc);
  const tabInfo = info(await chrome.tabs.get(id));
  if (mode === "main") {
    const text = renumber(String(result.text ?? ""), (local) => table.ref({ frameId: 0, doc, local }));
    return { tab: tabInfo, text, truncated: result.truncated === true };
  }
  const items = (Array.isArray(result.items) ? result.items : []).map((item: unknown) => {
    if (typeof item !== "object" || item === null || !("ref" in item)) return item;
    return { ...item, ref: typeof item.ref === "number" ? table.ref({ frameId: 0, doc, local: item.ref }) : null };
  });
  return { tab: tabInfo, items };
}

async function read(params: Params): Promise<Record<string, unknown>> {
  const tab = await tabOf(params);
  const id = idOf(tab);
  if (params.mode === "main" || params.mode === "items") return readTop(id, params.mode);
  const frames = await framesOf(id);
  const table = tableOf(id);
  const texts = await Promise.all(
    frames.map(async (frame) => {
      try {
        const result = await ask(id, frame.frameId, { op: "read" });
        const doc = String(result.doc);
        const text = renumber(String(result.text ?? ""), (local) => table.ref({ frameId: frame.frameId, doc, local }));
        return { frame, text, truncated: result.truncated === true };
      } catch (error) {
        if (frame.frameId === 0) throw error;
        return null;
      }
    }),
  );
  const parts = texts.filter((part): part is NonNullable<typeof part> => part !== null && part.text.trim() !== "");
  const text = parts.map((part) => (part.frame.frameId === 0 ? part.text : `--- frame ${part.frame.url} ---\n${part.text}`)).join("\n");
  return { tab: info(await chrome.tabs.get(id)), text, truncated: parts.some((part) => part.truncated) };
}

/** A new tab in the window in front, where the person watches. */
async function openInFront(url: string): Promise<chrome.tabs.Tab> {
  const front = await chrome.windows.getLastFocused().catch(() => null);
  return chrome.tabs.create({ url, active: true, ...(front?.id !== undefined ? { windowId: front.id } : {}) });
}

/**
 * A page for an agent at work on another Desktop: beside tab `near` (one it opened there before),
 * else in a new window of its own, which Dashi puts on the agent's Space. Never focused: the
 * person's window keeps the keyboard.
 */
async function openOwn(url: string, near: unknown): Promise<chrome.tabs.Tab> {
  const beside = typeof near === "number" ? await chrome.tabs.get(near).catch(() => null) : null;
  if (beside?.windowId !== undefined) return chrome.tabs.create({ url, active: true, windowId: beside.windowId });
  const [tab] = (await chrome.windows.create({ url, focused: false })).tabs ?? [];
  return tab ?? openInFront(url);
}

async function open(params: Params): Promise<Record<string, unknown>> {
  const url = String(params.url ?? "");
  if (typeof params.tab === "number") {
    const tab = await tabOf(params);
    const watch = watchLoad(idOf(tab), LOAD_MS);
    await chrome.tabs.update(idOf(tab), { url, active: true });
    const load = await watch.done;
    return { tab: info(await chrome.tabs.get(idOf(tab))), load, page: await probe(idOf(tab)) };
  }
  const created = params.own === true ? await openOwn(url, params.near) : await openInFront(url);
  const load = await watchLoad(idOf(created), LOAD_MS).done;
  return { tab: info(await chrome.tabs.get(idOf(created))), load, page: await probe(idOf(created)) };
}

/** A page just opened, at a glance: its address and title, whether it asks for a password or shows a CAPTCHA. */
const probe = (tab: number): Promise<Record<string, unknown> | null> => ask(tab, 0, { op: "probe" }).catch(() => null);

async function click(params: Params): Promise<Record<string, unknown>> {
  const tab = idOf(await tabOf(params));
  const target = await targetOf(tab, params.ref);
  const download = watchDownload();
  const watch = watchLoad(tab, LOAD_MS);
  let result: Record<string, unknown>;
  try {
    result = await ask(tab, target.frameId, { op: "click", doc: target.doc, ref: target.local });
  } catch (error) {
    watch.cancel();
    download.cancel();
    throw error;
  }
  if (typeof result.openTab === "string") {
    watch.cancel();
    download.cancel();
    const created = await chrome.tabs.create({ url: result.openTab, active: true });
    const load = await watchLoad(idOf(created), LOAD_MS).done;
    return { described: result.described, opened: info(await chrome.tabs.get(idOf(created))), load };
  }
  return { described: result.described, ...(await after(tab, target.frameId, watch, result.mayNavigate === true, download)) };
}

/**
 * What an action led to: a page that loaded (the browser's events say so), else what changed in
 * the page, read by the content script once it was quiet (content/changes.ts).
 */
async function after(
  tab: number,
  frameId: number,
  watch: ReturnType<typeof watchLoad>,
  mayNavigate: boolean,
  download: ReturnType<typeof watchDownload> | null = null,
): Promise<Record<string, unknown>> {
  const grace = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), mayNavigate ? MAY_NAVIGATE_MS : CLICK_NAVIGATE_MS));
  const downloading = download ? download.created.then((yes) => (yes ? "download" : false)) : new Promise<false>(() => {});
  const started = await Promise.race([watch.started, grace, downloading]);
  if (started === "download" && download) {
    // A download's navigation never loads a page: what landed is the answer.
    watch.cancel();
    return { tab: info(await chrome.tabs.get(tab)), download: await download.finished(DOWNLOAD_MS) };
  }
  download?.cancel();
  if (!started) {
    watch.cancel();
    const changes = await ask(tab, frameId, { op: "changes" }).catch(() => null);
    return { tab: info(await chrome.tabs.get(tab)), ...(changes ? { changes } : {}) };
  }
  const load = await watch.done;
  return { load, tab: info(await chrome.tabs.get(tab)) };
}

/** The frame with the keyboard focus: the one whose document has it and isn't passing it to a frame of its own. */
async function focusedFrame(tab: number): Promise<number> {
  const frames = await framesOf(tab);
  const answers = await Promise.all(
    frames.map((frame) =>
      ask(tab, frame.frameId, { op: "focus" }).then(
        (r) => ({ frame, r }),
        () => null,
      ),
    ),
  );
  const inside = answers.find((answer) => answer?.r.hasFocus === true && answer.r.inFrame !== true);
  return inside?.frame.frameId ?? 0;
}

async function field(params: Params): Promise<Record<string, unknown>> {
  const tab = await tabOf(params);
  const id = idOf(tab);
  let frameId = typeof params.frameId === "number" ? params.frameId : 0;
  let message: Params = { op: "field", focus: params.focus === true };
  if (typeof params.ref === "number") {
    const target = await targetOf(id, params.ref);
    frameId = target.frameId;
    message = { ...message, doc: target.doc, ref: target.local };
  }
  // Dashi's keys go to the tab in front of its window: this one.
  if (params.focus === true && !tab.active) await chrome.tabs.update(id, { active: true });
  const result = await ask(id, frameId, message);
  const documents = documentsOf(await framesOf(id), frameId);
  return { ...result, frameId, documents, tab: info(await chrome.tabs.get(id)) };
}

export const METHODS: Record<string, Method> = {
  ...MORE_METHODS,
  tabs: async () => {
    const front = await chrome.windows.getLastFocused().catch(() => null);
    return { tabs: (await chrome.tabs.query({ windowType: "normal" })).map(info), focusedWindow: front?.id ?? null };
  },
  activate: async (params) => {
    const tab = await tabOf(params);
    return { tab: info(await chrome.tabs.update(idOf(tab), { active: true })) };
  },
  open,
  read,
  click,
  fill: async (params) => (await onElement(params, "fill", { text: String(params.text ?? "") })).result,
  select: async (params) => {
    const tab = idOf(await tabOf(params));
    const target = await targetOf(tab, params.ref);
    const watch = watchLoad(tab, LOAD_MS);
    const result = await ask(tab, target.frameId, { op: "select", doc: target.doc, ref: target.local, value: String(params.value ?? "") }).catch(
      (error: unknown) => {
        watch.cancel();
        throw error;
      },
    );
    return { ...result, ...(await after(tab, target.frameId, watch, false)) };
  },
  press: async (params) => {
    const tab = idOf(await tabOf(params));
    const frameId = await focusedFrame(tab);
    const watch = watchLoad(tab, LOAD_MS);
    const result = await ask(tab, frameId, { op: "press", chords: params.chords }).catch((error: unknown) => {
      watch.cancel();
      throw error;
    });
    // Only Return submits a form: other keys get the short wait for a load.
    const submits = (parseChords(params.chords) ?? []).some((chord) => /^(Return|KP_Enter)$/.test(chord.key));
    return { ...result, ...(await after(tab, frameId, watch, submits)) };
  },
  scroll: async (params) => {
    if (typeof params.ref === "number") return (await onElement(params, "scroll", { how: params.how })).result;
    const tab = idOf(await tabOf(params));
    return ask(tab, 0, { op: "scroll", how: params.how, pages: params.pages });
  },
  field,
  wait: async (params) => waitInTab(idOf(await tabOf(params)), params),
  outcome: async (params) => outcomeInTab(idOf(await tabOf(params)), params),
  close: async (params) => tabMethod("close", idOf(await tabOf(params))),

  reload: async (params) => tabMethod("reload", idOf(await tabOf(params))),
  back: async (params) => tabMethod("back", idOf(await tabOf(params))),
  forward: async (params) => tabMethod("forward", idOf(await tabOf(params))),
  filled: async (params) => {
    const tab = idOf(await tabOf(params));
    if (typeof params.ref === "number") return (await onElement(params, "filled")).result;
    return ask(tab, typeof params.frameId === "number" ? params.frameId : 0, { op: "filled" });
  },
};
