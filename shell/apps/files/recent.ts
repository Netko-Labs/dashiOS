/** Recent files from the desktop's shared history, `recently-used.xbel` (what GTK, KDE, and the file choosers write). */

import { parseFileUri } from "./uri.ts";

export interface RecentFile {
  path: string;
  /** Milliseconds since the epoch of the last use. */
  time: number;
}

const decode = (text: string): string => text.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (_, name: string | undefined, dec: string | undefined, hex: string | undefined) => {
  if (name) return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name.toLowerCase()] ?? "";
  const code = dec ? Number(dec) : Number.parseInt(hex ?? "", 16);
  return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
});

/** The files in an xbel document, most recently used first; the same file appears once. Not a general XML parser: `<bookmark href=… modified=… visited=…>` is all it reads. */
export function parseRecentlyUsed(xml: string): RecentFile[] {
  const files = new Map<string, number>();
  for (const match of xml.matchAll(/<bookmark\s([^>]*)>/g)) {
    const attrs = match[1] ?? "";
    const href = /\bhref="([^"]*)"/.exec(attrs)?.[1];
    if (!href) continue;
    const path = parseFileUri(decode(href));
    if (!path) continue;
    const times = ["visited", "modified", "added"].map((key) => {
      const value = new RegExp(`\\b${key}="([^"]*)"`).exec(attrs)?.[1];
      const time = value ? Date.parse(value) : Number.NaN;
      return Number.isFinite(time) ? time : 0;
    });
    const time = Math.max(...times);
    files.set(path, Math.max(files.get(path) ?? 0, time));
  }
  return [...files].map(([path, time]) => ({ path, time })).sort((a, b) => b.time - a.time);
}
