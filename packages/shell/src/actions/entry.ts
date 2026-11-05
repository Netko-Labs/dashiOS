/**
 * The desktop entry that makes Dashi the handler of `dashi://` links
 * (`x-scheme-handler/dashi`): written beside the first-party apps' entries
 * (desktop-entries.ts), hidden from lists, running bin/dashi-open.ts with
 * the link. The system default (session/dashi-mimeapps.list) names it.
 */

import { type EntryContext, escapeValue, execLine, MARKER_KEY } from "../desktop-entries.ts";

export const LINKS_ENTRY_ID = "dev.dashi.links";
export const SCHEME_MIME = "x-scheme-handler/dashi";

/** `{file, text}` of the entry, or null when a path in it cannot be written into one. */
export function linksEntry(context: EntryContext): { file: string; text: string } | null {
  const exec = execLine([context.bun, `${context.root}bin/dashi-open.ts`], "%u");
  const path = escapeValue(context.root);
  if (exec === null || path === null) return null;
  const text = [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.5",
    "Name=Dashi Links",
    "Comment=Opens dashi:// links in Dashi",
    `Exec=${exec}`,
    `Path=${path}`,
    "Terminal=false",
    "NoDisplay=true",
    `MimeType=${SCHEME_MIME};`,
    `${MARKER_KEY}=true`,
    "",
  ].join("\n");
  return { file: `${LINKS_ENTRY_ID}.desktop`, text };
}
