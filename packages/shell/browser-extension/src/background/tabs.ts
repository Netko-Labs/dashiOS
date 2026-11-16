/**
 * The tab tools (close_tab, reload_tab, go_back, go_forward): the browser's
 * own calls, each waited out by the browser's events. A page brought back
 * from the back-forward cache fires no load of its own, so a tab that says
 * it is complete ends the wait too (`tabs.onUpdated`).
 */

import { ask, watchLoad } from "./frames.ts";

const LOAD_MS = 30_000;

/** How long a step in a page's own history has to start a load before it is taken to have gone nowhere. */
const STEP_MS = 1500;

/** Until the tab's page has loaded after `go`; what loaded, or that nothing did. */
async function navigate(tab: number, go: () => Promise<void>, startMs = LOAD_MS): Promise<Record<string, unknown>> {
  const before = await chrome.tabs.get(tab);
  const watch = watchLoad(tab, LOAD_MS);
  let onUpdated: ((id: number, change: { status?: string }) => void) | null = null;
  const restored = new Promise<{ loaded: boolean }>((resolve) => {
    onUpdated = (id, change) => {
      if (id === tab && change.status === "complete") resolve({ loaded: true });
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
  const done = () => {
    watch.cancel();
    if (onUpdated) chrome.tabs.onUpdated.removeListener(onUpdated);
  };
  try {
    await go();
  } catch (error) {
    done();
    throw error;
  }
  const nowhere = new Promise<{ loaded: boolean }>((resolve) => setTimeout(() => resolve({ loaded: false }), startMs));
  const started = await Promise.race([watch.started.then((yes) => (yes ? "started" : "no")), restored.then(() => "restored"), nowhere.then(() => "nowhere")]);
  const load = started === "nowhere" ? { loaded: false } : started === "restored" ? { loaded: true } : await Promise.race([watch.done, restored]);
  done();
  const after = await chrome.tabs.get(tab);
  return { load, moved: (after.url ?? "") !== (before.url ?? ""), url: after.url ?? "", title: after.title ?? "" };
}

/**
 * Back or forward: the browser's own step; where it refuses (Chromium skips history entries a page left
 * with no person's gesture, and an agent's click is none), the page's own `history.go` in its frame.
 */
async function step(tab: number, by: -1 | 1): Promise<Record<string, unknown>> {
  try {
    return await navigate(tab, () => (by < 0 ? chrome.tabs.goBack(tab) : chrome.tabs.goForward(tab)));
  } catch {
    return navigate(tab, async () => void (await ask(tab, 0, { op: "history", by })), STEP_MS);
  }
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
      return step(tab, -1);
    case "forward":
      return step(tab, 1);
  }
}
