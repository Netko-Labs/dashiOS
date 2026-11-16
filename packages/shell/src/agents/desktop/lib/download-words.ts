/** What a click that started a download says (desktop/browser.ts). */

import { isRecord } from "@dashi/shape";

/** A click's download, in words: where it landed and whether it is whole. */
export function downloadWords(download: unknown): string {
  if (!isRecord(download)) return "It started a download Dashi couldn't follow: list_downloads shows it.";
  const path = typeof download.path === "string" ? download.path : "";
  const bytes = typeof download.bytes === "number" ? download.bytes : 0;
  if (download.state === "complete") return `It downloaded a file: ${path} (${bytes} bytes).`;
  if (download.state === "interrupted") return `It started a download that stopped (${String(download.error ?? "interrupted")}).`;
  return `It is downloading ${path || "a file"} (${bytes} bytes so far): wait_for {file} with its path, or list_downloads.`;
}
