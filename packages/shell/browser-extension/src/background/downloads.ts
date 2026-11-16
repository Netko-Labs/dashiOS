/**
 * Downloads, through the browser's own downloads API: the list (newest
 * first), and a watch a click starts, so a click that downloads a file says
 * where it landed once it is whole.
 */

/** A download as the shell is told it. */
function about(item: chrome.downloads.DownloadItem): Record<string, unknown> {
  return {
    id: item.id,
    path: item.filename,
    url: item.finalUrl || item.url,
    mime: item.mime ?? "",
    state: item.state,
    ...(item.error ? { error: item.error } : {}),
    bytes: item.bytesReceived,
    total: item.totalBytes,
    started: item.startTime,
    exists: item.exists,
  };
}

export async function listDownloads(limit: number): Promise<Record<string, unknown>> {
  const items = await chrome.downloads.search({ orderBy: ["-startTime"], limit: Math.max(1, Math.min(limit, 100)) });
  return { downloads: items.map(about) };
}

/** Until a download starts; then, on `finished`, until it is whole or stops. */
export function watchDownload(): { created: Promise<boolean>; finished(ms: number): Promise<Record<string, unknown> | null>; cancel(): void } {
  let id: number | null = null;
  let begin: (yes: boolean) => void = () => {};
  const created = new Promise<boolean>((resolve) => {
    begin = resolve;
  });
  const onCreated = (item: chrome.downloads.DownloadItem) => {
    if (id !== null) return;
    id = item.id;
    begin(true);
  };
  chrome.downloads.onCreated.addListener(onCreated);
  const cancel = () => {
    chrome.downloads.onCreated.removeListener(onCreated);
    begin(false);
  };
  const finished = async (ms: number): Promise<Record<string, unknown> | null> => {
    cancel();
    if (id === null) return null;
    const mine = id;
    const done = new Promise<void>((resolve) => {
      const timer = setTimeout(stop, ms);
      function onChanged(delta: { id: number; state?: { current?: string } }) {
        if (delta.id === mine && (delta.state?.current === "complete" || delta.state?.current === "interrupted")) stop();
      }
      function stop() {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(onChanged);
        resolve();
      }
      chrome.downloads.onChanged.addListener(onChanged);
      void chrome.downloads.search({ id: mine }).then(([item]) => {
        if (item && item.state !== "in_progress") stop();
      });
    });
    await done;
    const [item] = await chrome.downloads.search({ id: mine });
    return item ? about(item) : null;
  };
  return { created, finished, cancel };
}
