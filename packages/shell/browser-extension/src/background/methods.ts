/**
 * The shell's requests, carried out (protocol: packages/shell/src/browser/
 * protocol.ts). Tabs are the browser's ids; element numbers are the tab's
 * (RefTable), each pointing at a frame's document and its own number there.
 */

import { renumber } from "../page/refs.ts";
import { ask, documentsOf, framesOf, tableOf, watchLoad } from "./frames.ts";

type Params = Record<string, unknown>;
type Method = (params: Params) => Promise<Record<string, unknown>>;

const LOAD_MS = 30_000;
/** After a click on a link or a submit button, how long a load has to begin; after another click, less. */
const MAY_NAVIGATE_MS = 1_000;
const CLICK_NAVIGATE_MS = 250;

function info(tab: chrome.tabs.Tab): Record<string, unknown> {
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: tab.active,
    title: tab.title ?? "",
    url: tab.url || tab.pendingUrl || "",
    loading: tab.status === "loading",
  };
}

/** The tab asked for, else the one in front in the window last used. */
async function tabOf(params: Params): Promise<chrome.tabs.Tab> {
  if (typeof params.tab === "number") {
    try {
      return await chrome.tabs.get(params.tab);
    } catch {
      throw new Error(`There is no tab ${params.tab}; list_tabs shows them.`);
    }
  }
  const [front] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: "normal" });
  if (!front?.id) throw new Error("The browser has no window open.");
  return front;
}

const idOf = (tab: chrome.tabs.Tab): number => {
  if (tab.id === undefined) throw new Error("That tab has no id.");
  return tab.id;
};

/** Where a tab's number points, or why it points nowhere. */
function targetOf(tab: number, ref: unknown) {
  const target = typeof ref === "number" ? tableOf(tab).target(ref) : null;
  if (!target) throw new Error(`There is no element ${String(ref)} on this page now; read_page again.`);
  return target;
}

async function onElement(params: Params, op: string, extra: Params = {}): Promise<{ tab: number; result: Record<string, unknown> }> {
  const tab = idOf(await tabOf(params));
  const target = targetOf(tab, params.ref);
  const result = await ask(tab, target.frameId, { op, doc: target.doc, ref: target.local, ...extra });
  return { tab, result };
}

async function read(params: Params): Promise<Record<string, unknown>> {
  const tab = await tabOf(params);
  const id = idOf(tab);
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

async function open(params: Params): Promise<Record<string, unknown>> {
  const url = String(params.url ?? "");
  if (typeof params.tab === "number") {
    const tab = await tabOf(params);
    const watch = watchLoad(idOf(tab), LOAD_MS);
    await chrome.tabs.update(idOf(tab), { url, active: true });
    const load = await watch.done;
    return { tab: info(await chrome.tabs.get(idOf(tab))), load };
  }
  const front = await chrome.windows.getLastFocused().catch(() => null);
  const created = await chrome.tabs.create({ url, active: true, ...(front?.id !== undefined ? { windowId: front.id } : {}) });
  const load = await watchLoad(idOf(created), LOAD_MS).done;
  return { tab: info(await chrome.tabs.get(idOf(created))), load };
}

async function click(params: Params): Promise<Record<string, unknown>> {
  const tab = idOf(await tabOf(params));
  const target = targetOf(tab, params.ref);
  const watch = watchLoad(tab, LOAD_MS);
  let result: Record<string, unknown>;
  try {
    result = await ask(tab, target.frameId, { op: "click", doc: target.doc, ref: target.local });
  } catch (error) {
    watch.cancel();
    throw error;
  }
  if (typeof result.openTab === "string") {
    watch.cancel();
    const created = await chrome.tabs.create({ url: result.openTab, active: true });
    const load = await watchLoad(idOf(created), LOAD_MS).done;
    return { described: result.described, opened: info(await chrome.tabs.get(idOf(created))), load };
  }
  const grace = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), result.mayNavigate ? MAY_NAVIGATE_MS : CLICK_NAVIGATE_MS));
  const started = await Promise.race([watch.started, grace]);
  if (!started) {
    watch.cancel();
    return { described: result.described, tab: info(await chrome.tabs.get(tab)) };
  }
  const load = await watch.done;
  return { described: result.described, load, tab: info(await chrome.tabs.get(tab)) };
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
    const target = targetOf(id, params.ref);
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
  select: async (params) => (await onElement(params, "select", { value: String(params.value ?? "") })).result,
  press: async (params) => {
    const tab = idOf(await tabOf(params));
    return ask(tab, await focusedFrame(tab), { op: "press", chords: params.chords });
  },
  scroll: async (params) => {
    if (typeof params.ref === "number") return (await onElement(params, "scroll", { how: params.how })).result;
    const tab = idOf(await tabOf(params));
    return ask(tab, 0, { op: "scroll", how: params.how, pages: params.pages });
  },
  field,
  filled: async (params) => {
    const tab = idOf(await tabOf(params));
    if (typeof params.ref === "number") return (await onElement(params, "filled")).result;
    return ask(tab, typeof params.frameId === "number" ? params.frameId : 0, { op: "filled" });
  },
};
