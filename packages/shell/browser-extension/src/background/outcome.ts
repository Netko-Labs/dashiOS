/**
 * A sign-in's outcome, asked after Dashi pressed Return (sign_in, fill_code):
 * the content script watches the page until it can tell (content/outcome.ts);
 * a page that navigates is asked again in its new document, until the same
 * deadline. The answer is page/outcome.ts's `Outcome`, never a field's value.
 */

import { ask, watchLoad } from "./frames.ts";

type Params = Record<string, unknown>;

const DEFAULT_MS = 15_000;

export async function outcomeInTab(tab: number, params: Params): Promise<Record<string, unknown>> {
  const timeoutMs = Math.max(1000, Math.min(typeof params.timeoutMs === "number" ? params.timeoutMs : DEFAULT_MS, 30_000));
  const started = Date.now();
  const until = started + timeoutMs;
  const message = { op: "outcome", field: params.field === "code" ? "code" : "password", urlBefore: String(params.urlBefore ?? ""), until };
  for (let attempt = 0; attempt < 6 && Date.now() < until; attempt++) {
    const now = await chrome.tabs.get(tab);
    if (now.status === "loading") {
      const load = await watchLoad(tab, until - Date.now()).done;
      if (!load.loaded && load.error === "still loading") break;
    }
    try {
      const result = await ask(tab, 0, message);
      return { ...result, ms: Date.now() - started };
    } catch {
      // The page went while it was watched (it navigated): ask the new one.
    }
  }
  const tabNow = await chrome.tabs.get(tab);
  return { outcome: { kind: tabNow.status === "loading" ? "loading" : "unchanged" }, url: tabNow.url ?? "", ms: Date.now() - started };
}
