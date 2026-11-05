/**
 * What the launcher lists, as data: sections of rows, each row with an id,
 * the words on its one line, the kind on its right, and what Enter does.
 * Pure: the panel (launcher.tsx) draws it, and the tests read it.
 *
 * The rules that keep the list honest:
 * - The instant rows (the answer, apps, Settings panes) come first and are
 *   laid out from the query alone, so nothing a slow source brings can move
 *   them. Files go below, under their own head, in slots held for them
 *   while their answer is on its way.
 * - Heads show once two kinds of instant rows do: Top hit, Apps, Settings.
 * - Nothing found is a way forward, never an empty panel.
 */

import { INFO } from "@dashi/ui";
import { SETTINGS_APP_ID } from "../apps.ts";
import { calculate, type Entry, search } from "../entries.ts";
import { type FileHit, MIN_QUERY } from "../file-search.ts";
import { type Answer, type AnswerContext, answerFor } from "./answers/index.ts";
import { didYouMean } from "./suggest.ts";

/** A 2 × 2 grid (All apps), drawn in ink like the panes' glyphs. */
const GRID = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" rx="1.2" fill="#000"/><rect x="9" y="2" width="5" height="5" rx="1.2" fill="#000"/><rect x="2" y="9" width="5" height="5" rx="1.2" fill="#000"/><rect x="9" y="9" width="5" height="5" rx="1.2" fill="#000"/></svg>`;

/** A file row: its hit and the icon resolved for it. */
export interface FileRow extends FileHit {
  icon: string;
}

/** An image file, or a one-color glyph drawn on a neutral tile. */
export type RowIcon = { image: string } | { glyph: string };

export type RowAction =
  | { kind: "open"; entry: Entry }
  | { kind: "open-file"; file: FileRow }
  | { kind: "copy"; text: string }
  /** Put these words in the field (the examples of the empty launcher). */
  | { kind: "type"; query: string }
  | { kind: "search-files"; query: string }
  | { kind: "find-software"; query: string }
  | { kind: "all-apps" };

export interface Row {
  id: string;
  title: string;
  /** A few muted words after the title, on the same line. */
  detail?: string;
  /** What it is, right-aligned and muted ("App", "Settings"); empty for nothing. */
  kind: string;
  icon: RowIcon;
  action: RowAction;
  /** The title in SemiBold (the answer). */
  strong?: true;
  /** A → at the right end: Enter goes somewhere in the launcher (All apps). */
  more?: true;
}

export interface Section {
  id: string;
  title?: string;
  /** Muted words at the head's right end. */
  aside?: string;
  rows: Row[];
  /** Blank slots held for rows still coming (files): drawn empty, never selected. */
  reserved?: number;
}

/** Where file rows stand for the query being shown. */
export type FilesState =
  /** Not asked: file search isn't offered here, the query is short, or it is a sum. */
  | { kind: "none" }
  /** File search is off (no LocalSearch). */
  | { kind: "off" }
  /** Asked; the answer hasn't come. `reserved` slots are held for it. */
  | { kind: "waiting"; reserved: number }
  | { kind: "found"; files: readonly FileRow[] };

/**
 * Where file rows stand: none for a short query or a sum (pure math never
 * asks), off when file search is, found when the last answer is for this
 * query, else waiting with as many slots held as the last answer filled.
 */
export function filesStateFor(state: {
  query: string;
  /** File search is offered here at all. */
  offered: boolean;
  /** It said it is off (no LocalSearch). */
  off: boolean;
  /** The last answer, null files meaning it could not look. */
  answer: { query: string; files: readonly FileRow[] | null } | null;
  /** Rows the last answer filled. */
  lastCount: number;
}): FilesState {
  const query = state.query.trim();
  if (!state.offered || query.length < MIN_QUERY || answerFor(query) !== null) return { kind: "none" };
  if (state.off) return { kind: "off" };
  if (state.answer?.query !== query) return { kind: "waiting", reserved: Math.min(state.lastCount, FILE_ROWS) };
  return state.answer.files === null ? { kind: "off" } : { kind: "found", files: state.answer.files };
}

export interface ListInput {
  query: string;
  entries: readonly Entry[];
  recent: readonly Entry[];
  files: FilesState;
  /** All apps, A to Z, in place of what the empty field offers. */
  allApps?: boolean;
  /** What became of copying the answer to this query. */
  copied?: { query: string; ok: boolean } | null;
  /** An app that could not be started just now. */
  failed?: Entry | null;
  /** Icons for the rows that aren't an app's: the calculator's, Files', Software's. */
  icons: { calculator: string; files: string; software: string };
  /** The Region, the clock and the zone answers are worked out in (answers/). */
  answers?: AnswerContext;
}

/** Instant rows the panel has room for (the answer included), and file rows below them. */
export const LOCAL_ROWS = 5;
export const FILE_ROWS = 3;

const FILES_ID = "dev.dashi.files";
const SOFTWARE_ID = "dev.dashi.software";

/** A Settings pane's entry id, `dev.dashi.settings/<pane>`. */
export const isPane = (entry: Pick<Entry, "id">): boolean => entry.id.startsWith(`${SETTINGS_APP_ID}/`);

const kindOf = (entry: Entry): string => (isPane(entry) ? "Settings" : "App");
const iconOf = (entry: Entry): RowIcon => (entry.glyph ? { glyph: entry.glyph } : { image: entry.icon });

export function entryRow(entry: Entry, prefix = "entry"): Row {
  return {
    id: `${prefix}:${entry.id}`,
    title: entry.name,
    ...(entry.detail ? { detail: entry.detail } : {}),
    kind: kindOf(entry),
    icon: iconOf(entry),
    action: { kind: "open", entry },
  };
}

export function fileRow(file: FileRow): Row {
  const folder = file.mime === "inode/directory";
  return {
    id: `file:${file.url}`,
    title: file.name,
    detail: file.folder,
    kind: folder ? "Folder" : "File",
    icon: { image: file.icon },
    action: { kind: "open-file", file },
  };
}

/** The answer's row (a sum, a unit, money, a time): the answer in SemiBold, what it answers after it, Enter copies. */
export function answerRow(query: string, answer: Answer, icons: ListInput["icons"], copied?: ListInput["copied"]): Row {
  const done = copied && copied.query === query ? (copied.ok ? "Copied" : "Couldn't copy") : "Answer";
  return {
    id: "answer",
    title: answer.title,
    detail: answer.detail,
    kind: done,
    icon: { image: icons.calculator },
    action: { kind: "copy", text: answer.copy },
    strong: true,
  };
}

/** Apps the field can list A to Z (not panes, not hidden entries). */
export function allApps(entries: readonly Entry[]): Entry[] {
  return entries.filter((entry) => !entry.hidden && !isPane(entry)).sort((a, b) => a.name.localeCompare(b.name));
}

const allAppsRow: Row = { id: "all-apps", title: "All apps", detail: "A to Z", kind: "", icon: { glyph: GRID }, action: { kind: "all-apps" }, more: true };

/** The empty launcher's examples: what to type, and what it gives. Each is shown only if it works here. */
const EXAMPLES: ReadonlyArray<{ query: string; title: string; detail: string; kind: string }> = [
  { query: "wi-fi", title: "Wi-Fi", detail: "turn it on or off", kind: "Settings" },
  { query: "files", title: "Files", detail: "your documents and downloads", kind: "App" },
  { query: "15% of 80", title: "15% of 80", detail: "= 12", kind: "Answer" },
  { query: "dark mode", title: "Dark Mode", detail: "Appearance", kind: "Settings" },
];

function examples(entries: readonly Entry[], icons: ListInput["icons"]): Row[] {
  return EXAMPLES.flatMap((example): Row[] => {
    const match = search(entries, example.query, 1)[0];
    const sum = calculate(example.query);
    if (!match && sum === null) return [];
    const icon = match ? iconOf(match) : { image: icons.calculator };
    return [
      { id: `try:${example.query}`, title: example.title, detail: example.detail, kind: example.kind, icon, action: { kind: "type", query: example.query } },
    ];
  });
}

/** The instant rows, grouped: one untitled run for one kind, else Top hit, then Apps, then Settings. */
function grouped(rows: Row[]): Section[] {
  if (new Set(rows.map((row) => row.kind)).size < 2) return rows.length > 0 ? [{ id: "results", rows }] : [];
  const [top, ...rest] = rows as [Row, ...Row[]];
  const sections: Section[] = [{ id: "top", title: "Top hit", rows: [top] }];
  for (const [kind, title] of [
    ["App", "Apps"],
    ["Settings", "Settings"],
  ] as const) {
    const ofKind = rest.filter((row) => row.kind === kind);
    if (ofKind.length > 0) sections.push({ id: kind, title, rows: ofKind });
  }
  return sections;
}

function filesSection(state: FilesState, query: string): Section | null {
  switch (state.kind) {
    case "found":
      return state.files.length > 0 ? { id: "files", title: "Files", rows: state.files.slice(0, FILE_ROWS).map(fileRow) } : null;
    case "waiting":
      return state.reserved > 0 ? { id: "files", title: "Files", rows: [], reserved: Math.min(state.reserved, FILE_ROWS) } : null;
    case "off":
      return {
        id: "files",
        title: "Files",
        rows: [
          {
            id: "files-off",
            title: "File search is off",
            detail: "look in Files instead",
            kind: "",
            icon: { glyph: INFO },
            action: { kind: "search-files", query },
          },
        ],
      };
    case "none":
      return null;
  }
}

/** Nothing matched: say so, and offer what can still be done with the words. */
function nothingFound(input: ListInput, query: string): Section {
  const byId = (id: string) => input.entries.find((entry) => entry.id === id);
  const suggestion = didYouMean(input.entries, query);
  const files = byId(FILES_ID);
  const software = byId(SOFTWARE_ID);
  const rows: Row[] = [
    ...(suggestion ? [{ ...entryRow(suggestion, "suggest"), title: `Did you mean ${suggestion.name}?` }] : []),
    ...(files
      ? [
          {
            id: "search-files",
            title: `Search files for “${query}”`,
            kind: "Files",
            icon: { image: files.icon },
            action: { kind: "search-files", query },
          } satisfies Row,
        ]
      : []),
    ...(software
      ? [
          {
            id: "find-software",
            title: `Find “${query}” in Software`,
            kind: "Software",
            icon: { image: software.icon },
            action: { kind: "find-software", query },
          } satisfies Row,
        ]
      : []),
  ];
  return { id: "nothing", title: `Nothing called “${query}”`, rows };
}

/** Everything the launcher lists for `input`, top to bottom. */
export function buildSections(input: ListInput): Section[] {
  const query = input.query.trim();
  const failed: Section[] = input.failed
    ? [{ id: "failed", rows: [{ ...entryRow(input.failed, "failed"), title: `Couldn't open ${input.failed.name}`, detail: "try again", kind: "" }] }]
    : [];
  if (!query) {
    if (input.allApps) return [...failed, { id: "all", title: "All apps", rows: allApps(input.entries).map((entry) => entryRow(entry)) }];
    if (input.recent.length > 0)
      return [...failed, { id: "recent", title: "Recent", rows: [...input.recent.map((entry) => entryRow(entry, "recent")), allAppsRow] }];
    return [...failed, { id: "try", title: "Try", aside: "Searches this computer only", rows: [...examples(input.entries, input.icons), allAppsRow] }];
  }
  const answer = answerFor(query, input.answers);
  const found = search(input.entries, query, answer === null ? LOCAL_ROWS : LOCAL_ROWS - 1).map((entry) => entryRow(entry));
  const instant = [...(answer === null ? [] : [answerRow(query, answer, input.icons, input.copied)]), ...found];
  const files = filesSection(input.files, query);
  if (instant.length > 0) return [...failed, ...grouped(instant), ...(files ? [files] : [])];
  // Nothing instant: wait for the files before saying nothing is there (their slots, if any, are held).
  if (input.files.kind === "waiting") return [...failed, ...(files ? [files] : [])];
  if (files && input.files.kind === "found") return [...failed, files];
  return [...failed, nothingFound(input, query)];
}

/** The rows that can be selected, in order. */
export function selectable(sections: readonly Section[]): Row[] {
  return sections.flatMap((section) => section.rows);
}

/** The placeholder says what search can do right now. */
export function placeholderFor(fileSearch: boolean): string {
  return fileSearch ? "An app, a setting, a file, or a sum" : "An app, a setting, or a sum";
}
