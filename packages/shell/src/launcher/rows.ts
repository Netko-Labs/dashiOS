/**
 * What the launcher lists, as data: sections of rows, each row with an id,
 * the words on its one line, the kind on its right, and what Enter does.
 * Pure: the panel (launcher.tsx) draws it, and the tests read it.
 *
 * The rules that keep the list honest:
 * - The instant rows (the answer, then what the ranking found among apps,
 *   windows, settings, commands and menus) come first and are laid out from
 *   the query alone, so nothing a slow source brings can move them. Files go
 *   below, under their own head, in slots held for them while their answer
 *   is on its way.
 * - Heads show once two kinds of instant rows do: Top hit, then Windows,
 *   Apps, Settings, Commands, Menus.
 * - An alias the person gave is matched first, before the ranking.
 * - A typo is never a result: it is "Did you mean …?" when nothing else matched.
 * - Nothing found is a way forward, never an empty panel.
 */

import { INFO } from "@dashi/ui";
import { iconPath } from "../apps.ts";
import { calculate, type Entry } from "../entries.ts";
import { MIN_QUERY } from "../file-search.ts";
import { type Answer, type AnswerContext, answerFor } from "./answers/index.ts";
import { isPane, type LauncherItem, type LauncherWindow, launcherIndex, windowsOf } from "./items.ts";
import { commandCore } from "./ranking/commands.ts";
import { fold } from "./ranking/fold.ts";
import type { RankSignals } from "./ranking/item.ts";
import { type RankIndex, type RankResult, rank } from "./ranking/rank.ts";
import { actionRow, entryRow, type FileRow, fileNameMatches, fileRow, type Row, type RowGroup, shownName, windowRow } from "./row-model.ts";

export {
  entryRow,
  type FileRow,
  fileNameMatches,
  fileRow,
  type Row,
  type RowAction,
  type RowControl,
  type RowGroup,
  type RowIcon,
  shortFolder,
} from "./row-model.ts";

/** A 2 × 2 grid (All apps), drawn in ink like the panes' glyphs. */
const GRID = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" rx="1.2" fill="#000"/><rect x="9" y="2" width="5" height="5" rx="1.2" fill="#000"/><rect x="2" y="9" width="5" height="5" rx="1.2" fill="#000"/><rect x="9" y="9" width="5" height="5" rx="1.2" fill="#000"/></svg>`;

export interface Section {
  id: string;
  title?: string;
  /** Muted words at the head's right end. */
  aside?: string;
  rows: Row[];
  /** Blank slots held for rows still coming (files): drawn empty, never selected. */
  reserved?: number;
  /** Draw this many rows at once, scrolled with the selection (a scope's long list: scope.ts; All apps). */
  window?: number;
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
  // Only names that answer the words as a name would (row-model.ts `fileNameMatches`): LocalSearch matches inside words.
  return state.answer.files === null ? { kind: "off" } : { kind: "found", files: state.answer.files.filter((file) => fileNameMatches(file.name, query)) };
}

export interface ListInput {
  query: string;
  entries: readonly Entry[];
  recent: readonly Entry[];
  files: FilesState;
  /** What the ranking searches (items.ts `launcherIndex`); the entries alone when left out. */
  index?: RankIndex<LauncherItem>;
  /** The ranking's history: picks for this query and frecency (ranking/store.ts). */
  signals?: RankSignals;
  /** The open windows, most recent app first: an app with windows switches to its last one. */
  windows?: readonly LauncherWindow[];
  /** The person's aliases: folded alias → address (settings.json `launcher.aliases`). */
  aliases?: ReadonlyMap<string, string>;
  /** All apps, A to Z, in place of what the empty field offers. */
  allApps?: boolean;
  /** What became of copying the answer to this query. */
  copied?: { query: string; ok: boolean } | null;
  /** An app that could not be started just now. */
  failed?: Entry | null;
  /** Icons for the rows that aren't an app's: the calculator's, Files', Software's, and Dashi's own commands'. */
  icons: { calculator: string; files: string; software: string; command?: string };
  /** The Region, the clock and the zone answers are worked out in (answers/). */
  answers?: AnswerContext;
  /** Rows that fit at the person's text size (measures.ts); LOCAL_ROWS, FILE_ROWS and ALL_APPS_ROWS when left out. */
  limits?: { local: number; files: number; allApps?: number };
}

/** Instant rows the panel has room for (the answer included), and file rows below them. */
export const LOCAL_ROWS = 5;
export const FILE_ROWS = 3;
/** All apps drawn at once, scrolled with the selection (measures.ts `allAppsRows`). */
export const ALL_APPS_ROWS = 8;

const FILES_ID = "dev.dashi.files";
const SOFTWARE_ID = "dev.dashi.software";

export { isPane } from "./items.ts";

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
    group: "answer",
  };
}

/** Apps the field can list A to Z (not panes, not hidden entries), by the name the person reads. */
export function allApps(entries: readonly Entry[]): Entry[] {
  return entries.filter((entry) => !entry.hidden && !isPane(entry)).sort((a, b) => shownName(a).localeCompare(shownName(b)));
}

const allAppsRow: Row = { id: "all-apps", title: "All apps", detail: "A to Z", kind: "", icon: { glyph: GRID }, action: { kind: "all-apps" }, more: true };

/** The empty launcher's examples: what to type, and what it gives. Each is shown only if it works here. */
const EXAMPLES: ReadonlyArray<{ query: string; title: string; detail: string; kind: string }> = [
  { query: "wi-fi", title: "Wi-Fi", detail: "turn it on or off", kind: "Settings" },
  { query: "files", title: "Files", detail: "your documents and downloads", kind: "App" },
  { query: "15% of 80", title: "15% of 80", detail: "= 12", kind: "Answer" },
  { query: "dark mode", title: "Dark Mode", detail: "Appearance", kind: "Settings" },
];

const indexOf = (input: ListInput): RankIndex<LauncherItem> => input.index ?? launcherIndex({ entries: input.entries });

function examples(input: ListInput): Row[] {
  const index = indexOf(input);
  return EXAMPLES.flatMap((example): Row[] => {
    // Shown only when it lands where it says: "wi-fi" on the Wi-Fi switch, not on the Network pane (no Wi-Fi here).
    const sum = calculate(example.query);
    const match = sum === null ? rank(index, example.query, { limit: 1 })[0]?.item : undefined;
    const row = match ? rowFor(match, input) : null;
    if (sum === null && (!row || fold(row.title) !== fold(example.title))) return [];
    const icon = row ? row.icon : { image: input.icons.calculator };
    return [
      { id: `try:${example.query}`, title: example.title, detail: example.detail, kind: example.kind, icon, action: { kind: "type", query: example.query } },
    ];
  });
}

/** The row for a ranked item, its alias as a badge. */
export function rowFor(item: LauncherItem, input: Pick<ListInput, "entries" | "windows" | "aliases" | "icons">, prefix = "entry"): Row {
  const row = item.entry
    ? entryRow(item.entry, prefix, windowsOf(input.windows ?? [], item.entry.id))
    : item.window
      ? windowRow(item.window)
      : actionRow(item, {
          app: (id) => input.entries.find((entry) => entry.id === id || entry.wmClass === id)?.icon,
          dashi: input.icons.command ?? iconPath("generic"),
        });
  const alias = item.address ? aliasOf(input.aliases, item.address) : undefined;
  return { ...row, item, ...(prefix !== "entry" && !item.entry ? { id: `${prefix}:${item.id}` } : {}), ...(alias ? { badge: alias } : {}) };
}

/** The alias the person gave `address`, if any. */
function aliasOf(aliases: ReadonlyMap<string, string> | undefined, address: string): string | undefined {
  if (!aliases) return undefined;
  for (const [alias, target] of aliases) if (target === address) return alias;
  return undefined;
}

const TYPOS = new Set(["typo", "keywordTypo"]);

/**
 * What the query finds, best first: an alias first, then the ranking's
 * matches; typos only as a suggestion. A short command that finds nothing
 * as it is finds what it names ("turn on dark mode" is Dark Mode:
 * ranking/commands.ts).
 */
export function found(input: ListInput, limit: number): { items: LauncherItem[]; suggestion: LauncherItem | null } {
  const query = input.query.trim();
  const index = indexOf(input);
  const options = { limit: limit * 2, ...(input.signals ? { signals: input.signals } : {}) };
  let results: RankResult<LauncherItem>[] = rank(index, query, options);
  const core = commandCore(query);
  if (core && !results.some((result) => !TYPOS.has(result.match))) results = rank(index, core, options);
  const strong = results.filter((result) => !TYPOS.has(result.match)).map((result) => result.item);
  const target = input.aliases?.get(fold(query));
  const aliased = target ? index.prepared.find((each) => each.item.address === target)?.item : undefined;
  const items = aliased ? [aliased, ...strong.filter((item) => item !== aliased)] : strong;
  const suggestion = items.length === 0 && looksMisspelt(query) ? (results.find((result) => result.match === "typo")?.item ?? null) : null;
  return { items: items.slice(0, limit), suggestion };
}

/**
 * Whether "Did you mean …?" may be asked: a single word, a name misspelt
 * ("fierfox"). Never a sentence on its way ("turn on" is not "turn off",
 * Shut Down's words), nor a keyword one letter off.
 */
export const looksMisspelt = (query: string): boolean => !/\s/.test(query.trim());

/** The sections' heads and order once two kinds show. */
const GROUPS: ReadonlyArray<[RowGroup, string]> = [
  ["window", "Windows"],
  ["app", "Apps"],
  ["settings", "Settings"],
  ["command", "Commands"],
  ["menu", "Menus"],
];

/**
 * The instant rows, grouped: one untitled run for one kind, else Top hit,
 * then each kind under its head, the top hit's own kind first, so what came
 * with it stays by it ("screenshot": Screenshot…, then the other two
 * screenshots, then the Settings row that also answers to the word).
 */
function grouped(rows: Row[]): Section[] {
  if (new Set(rows.map((row) => row.group ?? "other")).size < 2) return rows.length > 0 ? [{ id: "results", rows }] : [];
  const [top, ...rest] = rows as [Row, ...Row[]];
  const sections: Section[] = [{ id: "top", title: "Top hit", rows: [top] }];
  const order = [...GROUPS.filter(([group]) => group === top.group), ...GROUPS.filter(([group]) => group !== top.group)];
  for (const [group, title] of order) {
    const ofKind = rest.filter((row) => row.group === group);
    // The ids stay what wave 1 named them ("App", "Settings").
    if (ofKind.length > 0) sections.push({ id: group === "app" ? "App" : group === "settings" ? "Settings" : group, title, rows: ofKind });
  }
  return sections;
}

function filesSection(state: FilesState, query: string, most = FILE_ROWS): Section | null {
  switch (state.kind) {
    case "found":
      return state.files.length > 0 ? { id: "files", title: "Files", rows: state.files.slice(0, most).map(fileRow) } : null;
    case "waiting":
      return state.reserved > 0 ? { id: "files", title: "Files", rows: [], reserved: Math.min(state.reserved, most) } : null;
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
function nothingFound(input: ListInput, query: string, suggestion: LauncherItem | null): Section {
  const byId = (id: string) => input.entries.find((entry) => entry.id === id);
  const files = byId(FILES_ID);
  const software = byId(SOFTWARE_ID);
  const suggested = suggestion ? rowFor(suggestion, input, "suggest") : null;
  const rows: Row[] = [
    ...(suggested ? [{ ...suggested, title: `Did you mean ${suggested.title}?` }] : []),
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
    ? [{ id: "failed", rows: [{ ...entryRow(input.failed, "failed"), title: `Couldn't open ${shownName(input.failed)}`, detail: "try again", kind: "" }] }]
    : [];
  if (!query) {
    if (input.allApps) {
      // Every app, drawn a window at a time that the selection and the wheel scroll: the list is never cut to fit the panel (fit.ts).
      const rows = allApps(input.entries).map((entry) => entryRow(entry));
      return [...failed, { id: "all", title: "All apps", rows, window: Math.min(input.limits?.allApps ?? ALL_APPS_ROWS, rows.length) }];
    }
    if (input.recent.length > 0)
      return [...failed, { id: "recent", title: "Recent", rows: [...input.recent.map((entry) => entryRow(entry, "recent")), allAppsRow] }];
    return [...failed, { id: "try", title: "Try", aside: "Searches this computer only", rows: [...examples(input), allAppsRow] }];
  }
  const answer = answerFor(query, input.answers);
  const local = input.limits?.local ?? LOCAL_ROWS;
  const { items, suggestion } = found(input, answer === null ? local : local - 1);
  const instant = [...(answer === null ? [] : [answerRow(query, answer, input.icons, input.copied)]), ...items.map((item) => rowFor(item, input))];
  const files = filesSection(input.files, query, input.limits?.files);
  if (instant.length > 0) return [...failed, ...grouped(instant), ...(files ? [files] : [])];
  // Nothing instant: wait for the files before saying nothing is there (their slots, if any, are held).
  if (input.files.kind === "waiting") return [...failed, ...(files ? [files] : [])];
  if (files && input.files.kind === "found") return [...failed, files];
  return [...failed, nothingFound(input, query, suggestion)];
}

/** The rows that can be selected, in order. */
export function selectable(sections: readonly Section[]): Row[] {
  return sections.flatMap((section) => section.rows);
}

/** The placeholder says what search can do right now. */
export function placeholderFor(fileSearch: boolean): string {
  return fileSearch ? "An app, a setting, a file, or a sum" : "An app, a setting, or a sum";
}
