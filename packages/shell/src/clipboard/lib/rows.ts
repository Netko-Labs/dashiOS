/**
 * The clipboard history and the snippets as launcher rows (launcher/
 * scope.ts), pure over their stores' snapshots so the tests read them. One
 * list each, drawn eight rows at a time and scrolled with the selection:
 * the history pinned first, then newest first, each row one line (VS-2):
 * the copy itself (its first line, a picture small, the files' names), the
 * app it came from, and at the right its age or "Pinned". The head counts
 * the copies and says, when it happened, how many were not kept and why.
 */

import type { Row, Section } from "../../launcher/index.ts";
import { CLIPBOARD, FILES, SNIPPET } from "../glyphs.ts";
import type { ClipEntry, HistorySnapshot, Skip } from "../history.ts";
import type { SkipReason } from "./privacy.ts";
import { keywordProblem, parseAdd, type Snippet } from "./snippets.ts";
import { fileUris } from "./watch.ts";

/** Rows drawn at once. */
export const SHOWN_ROWS = 8;
/** A row's title is cut to this many characters. */
const TITLE_CHARS = 56;

const fold = (text: string): string => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** One line of `text`, its runs of space made one, cut short with an ellipsis. */
export function oneLine(text: string, max = TITLE_CHARS): string {
  const line = text.replace(/\s+/g, " ").trim();
  const chars = [...line];
  return chars.length <= max ? line : `${chars.slice(0, max - 1).join("")}…`;
}

/** A file URI's last part, decoded. */
function fileName(uri: string): string {
  const last = uri.replace(/\/+$/, "").split("/").pop() ?? uri;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** What a copy's row is called. */
export function entryTitle(entry: ClipEntry): string {
  if (entry.kind === "image") return "Image";
  if (entry.kind === "files") {
    const names = fileUris(entry.text ?? "").map(fileName);
    const [first] = names;
    if (!first) return "Files";
    return names.length === 1 ? oneLine(first) : `${oneLine(first, 40)} and ${names.length - 1} more`;
  }
  return oneLine(entry.text ?? "");
}

/** How long ago, in a word or two: "Now", "2 min", "3 h", "Yesterday", "4 days". */
export function age(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days`;
}

export function entryRow(entry: ClipEntry, now: number, imagePath: (entry: ClipEntry) => string | null): Row {
  const size = entry.size ? `${entry.size.width} × ${entry.size.height}` : null;
  const detail = [size, entry.app].filter((part): part is string => !!part).join(" · ");
  const image = entry.kind === "image" ? imagePath(entry) : null;
  return {
    id: `clip:${entry.id}`,
    title: entryTitle(entry),
    ...(detail ? { detail } : {}),
    kind: entry.pinned ? "Pinned" : age(entry.copiedAt, now),
    icon: image ? { image } : { glyph: entry.kind === "files" ? FILES : CLIPBOARD },
    action: { kind: "scope", verb: "paste" },
  };
}

/** Whether `entry` answers every word typed (its text, its files' names, its app; "image" finds pictures). */
export function entryMatches(entry: ClipEntry, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const content =
    entry.kind === "image"
      ? "image picture"
      : entry.kind === "files"
        ? fileUris(entry.text ?? "")
            .map(fileName)
            .join(" ")
        : (entry.text ?? "");
  const haystack = fold(`${content} ${entry.app ?? ""}`);
  return words.every((word) => haystack.includes(word));
}

const REASONS: Readonly<Record<SkipReason, string>> = {
  secret: "marked secret",
  "password field": "a password field",
  "left out": "",
  paused: "while the screen was shared",
};

/** "2 copies not kept: a password field, KeePassXC"; null when every copy was kept. */
export function skippedSummary(skipped: readonly Skip[]): string | null {
  if (skipped.length === 0) return null;
  const why = [...new Set(skipped.map((skip) => (skip.reason === "left out" ? (skip.app ?? "a password manager") : REASONS[skip.reason])))];
  const count = skipped.length === 1 ? "1 copy not kept" : `${skipped.length} copies not kept`;
  return `${count}: ${why.join(", ")}`;
}

/** The history's rows for `query`, pinned first. */
export function historySections(
  snapshot: HistorySnapshot,
  query: string,
  options: { now: number; enabled: boolean; imagePath(entry: ClipEntry): string | null },
): Section[] {
  if (!options.enabled) {
    return [
      {
        id: "clipboard",
        rows: [
          {
            id: "clip:off",
            title: "Clipboard history is off",
            detail: "Turn it on in Settings › Keyboard",
            kind: "",
            icon: { glyph: CLIPBOARD },
            action: { kind: "scope", verb: "settings" },
          },
        ],
      },
    ];
  }
  const matching = snapshot.entries.filter((entry) => entryMatches(entry, query));
  const ordered = [...matching.filter((entry) => entry.pinned), ...matching.filter((entry) => !entry.pinned)];
  const rows = ordered.map((entry) => entryRow(entry, options.now, options.imagePath));
  const aside = skippedSummary(snapshot.skipped);
  if (rows.length === 0) {
    const empty = snapshot.entries.length === 0;
    rows.push({
      id: "clip:none",
      title: empty ? "Nothing copied yet" : "No copy has those words",
      detail: empty ? "What you copy shows here for 7 days" : "",
      kind: "",
      icon: { glyph: CLIPBOARD },
      action: { kind: "scope", verb: "none" },
    });
  }
  const count = snapshot.entries.length === 1 ? "1 copy" : `${snapshot.entries.length} copies`;
  return [{ id: "clipboard", title: count, ...(aside ? { aside } : {}), rows, window: SHOWN_ROWS }];
}

/** The snippets' rows for `query`: adding one when the field holds a keyword and its text, then those that match. */
export function snippetSections(snippets: readonly Snippet[], query: string): Section[] {
  const rows: Row[] = [];
  const adding = parseAdd(query);
  if (adding) {
    const problem = keywordProblem(adding.keyword, snippets);
    rows.push({
      id: "snippet:add",
      title: problem ?? `Add snippet “${adding.keyword}”`,
      detail: oneLine(adding.text, 80),
      kind: "",
      icon: { glyph: SNIPPET },
      action: { kind: "scope", verb: problem ? "none" : "add" },
      ...(problem ? { danger: true as const } : {}),
    });
  }
  const words = fold(query).split(/\s+/).filter(Boolean);
  const matching = adding
    ? []
    : snippets.filter((snippet) => {
        const haystack = fold(`${snippet.keyword} ${snippet.text}`);
        return words.every((word) => haystack.includes(word));
      });
  for (const snippet of matching) {
    rows.push({
      id: `snippet:${snippet.keyword}`,
      title: snippet.keyword,
      detail: oneLine(snippet.text, 80),
      kind: "Snippet",
      icon: { glyph: SNIPPET },
      action: { kind: "scope", verb: "paste" },
    });
  }
  if (rows.length === 0) {
    rows.push({
      id: "snippet:how",
      title: snippets.length === 0 ? "No snippets yet" : "No snippet has those words",
      detail: "Type a keyword, a space, and its text: ;addr Calle de la Luna 12",
      kind: "",
      icon: { glyph: SNIPPET },
      action: { kind: "scope", verb: "none" },
    });
  }
  return [{ id: "snippets", title: "Snippets", aside: "Typed anywhere, a keyword becomes its text", rows, window: SHOWN_ROWS }];
}
