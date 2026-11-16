/**
 * The tab tools (close_tab, reload_tab, go_back, go_forward): the browser's
 * own calls, each waited out by the browser's events. A page brought back
 * from the back-forward cache fires no load of its own, so a tab that says
 * it is complete ends the wait too (`tabs.onUpdated`).
 */

import { watchLoad } from "./frames.ts";

const LOAD_MS = 30_000;

/** Until the tab's page has loaded after `go`; what loaded, or that nothing did. */
async function navigate(tab: number, go: () => Promise<void>): Promise<Record<string, unknown>> {
  const before = await chrome.tabs.get(tab);
  const watch = watchLoad(tab, LOAD_MS);
  let onUpdated: ((id: number, change: { status?: string }) => void) | null = null;
  const restored = new Promise<{ loaded: boolean }>((resolve) => {
    onUpdated = (id, change) => {
      if (id === tab && change.status === "complete") resolve({ loaded: true });
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
  try {
    await go();
  } catch (error) {
    watch.cancel();
    throw error;
  }
  const load = await Promise.race([watch.done, restored]);
  watch.cancel();
  if (onUpdated) chrome.tabs.onUpdated.removeListener(onUpdated);
  const after = await chrome.tabs.get(tab);
  return { load, moved: (after.url ?? "") !== (before.url ?? ""), url: after.url ?? "", title: after.title ?? "" };
}

export async function tabMethod(how: "close" | "reload" | "back" | "forward", tab: number): Promise<Record<string, unknown>> {
  switch (how) {
    case "close": {
      const was = await chrome.tabs.get(tab);
      await chrome.tabs.remove(tab);
      return { closed: true, title: was.title ?? "", url: was.url ?? "" };
    }
    case "reload":
      return navigate(tab, () => chrome.tabs.reload(tab));
    case "back":
      return navigate(tab, () => chrome.tabs.goBack(tab));
    case "forward":
      return navigate(tab, () => chrome.tabs.goForward(tab));
  }
}
