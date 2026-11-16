/** Which tab a request is for, its tab as the shell is told it, and where an element's number points. */

import type { RefTarget } from "../page/refs.ts";
import { renumber } from "../page/refs.ts";
import { ask, tableOf } from "./frames.ts";

export type Params = Record<string, unknown>;

export function info(tab: chrome.tabs.Tab): Record<string, unknown> {
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
export async function tabOf(params: Params): Promise<chrome.tabs.Tab> {
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

export const idOf = (tab: chrome.tabs.Tab): number => {
  if (tab.id === undefined) throw new Error("That tab has no id.");
  return tab.id;
};

/** At most this much of a new page goes with an error about a number from the old one. */
const TOP_LIMITS = { chars: 3000, elements: 40 };

/** Where a tab's number points; a number from a page that has gone is an error with the new page's top, freshly numbered. */
export async function targetOf(tab: number, ref: unknown): Promise<RefTarget> {
  const target = typeof ref === "number" ? tableOf(tab).target(ref) : null;
  if (target) return target;
  const top = await ask(tab, 0, { op: "read", limits: TOP_LIMITS }).catch(() => null);
  const text = top ? renumber(String(top.text ?? ""), (local) => tableOf(tab).ref({ frameId: 0, doc: String(top.doc), local })) : "";
  throw new Error(`There is no element ${String(ref)} on this page now: the page changed.${text ? ` Its top now reads:\n${text}` : " read_page again."}`);
}
