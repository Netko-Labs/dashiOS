/** Recent files from the desktop's shared history, `recently-used.xbel` (what GTK, KDE, and the file choosers write). */

import { fileUri, parseFileUri } from "../../../src/shared/files/index.ts";

export interface RecentFile {
  path: string;
  /** Milliseconds since the epoch of the last use. */
  time: number;
}

const decode = (text: string): string =>
  text.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (_, name: string | undefined, dec: string | undefined, hex: string | undefined) => {
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

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);

const EMPTY_XBEL = `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0"
      xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks"
      xmlns:mime="http://www.freedesktop.org/standards/shared-mime-info"
>
</xbel>
`;

/** A file used: where it is, its type, and the app that used it (its name in the history, and how it starts). */
export interface RecentUse {
  path: string;
  mime: string;
  app: string;
  exec: string;
}

/**
 * `xml` (an xbel document, or null for none yet) with `uses` in it at `at`:
 * a file already there is marked used again, keeping what else it says;
 * one that isn't is added. What GTK and KDE read, so a pick shows in every
 * Recents (Files', the choosers').
 */
export function withRecent(xml: string | null, uses: readonly RecentUse[], at: Date): string {
  const stamp = `${at.toISOString().slice(0, 19)}Z`;
  let doc = xml && /<\/xbel>/.test(xml) ? xml : EMPTY_XBEL;
  for (const use of uses) {
    const href = escape(fileUri(use.path));
    const open = new RegExp(`<bookmark\\s[^>]*\\bhref="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
    const found = open.exec(doc);
    if (found) {
      const tag = found[0].replace(/\b(modified|visited)="[^"]*"/g, `$1="${stamp}"`);
      doc = doc.slice(0, found.index) + tag + doc.slice(found.index + found[0].length);
      continue;
    }
    const bookmark = [
      `  <bookmark href="${href}" added="${stamp}" modified="${stamp}" visited="${stamp}">`,
      "    <info>",
      '      <metadata owner="http://freedesktop.org">',
      `        <mime:mime-type type="${escape(use.mime)}"/>`,
      "        <bookmark:applications>",
      `          <bookmark:application name="${escape(use.app)}" exec="${escape(use.exec)}" modified="${stamp}" count="1"/>`,
      "        </bookmark:applications>",
      "      </metadata>",
      "    </info>",
      "  </bookmark>",
      "",
    ].join("\n");
    const end = doc.lastIndexOf("</xbel>");
    doc = `${doc.slice(0, end)}${bookmark}${doc.slice(end)}`;
  }
  return doc;
}
