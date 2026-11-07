/**
 * The table's lines: by app (the default), each app one line with its icon,
 * its name and its processes' numbers added up, its processes under it when
 * it is opened, and processes no app started on lines of their own; or every
 * process on a line of its own (View › All processes). Pure: the rows (already
 * searched and scoped) come in, sorted lines go out.
 */

import { type SortableColumn, type SortState, sortRows } from "@dashi/ui";
import type { ProcessRow } from "./sample.ts";

/** What a line adds up, for the columns. */
export interface Metrics {
  cpu: number;
  cpuTime: number;
  threads: number;
  memory: number;
  read: number | null;
  written: number | null;
  readRate: number | null;
  writeRate: number | null;
  sockets: number | null;
  wakeups: number | null;
  gpu: number | null;
  impact: number;
}

export interface Line extends Metrics {
  /** "app:<app key>" or "pid:<pid>": the selection, kept while numbers and order change. */
  key: string;
  kind: "app" | "process";
  name: string;
  /** The app's icon (also beside a process in the flat list); null for a process no app started. */
  icon: string | null;
  /** 1 for a process shown under its app. */
  depth: 0 | 1;
  /** An app line's processes. */
  members: readonly ProcessRow[];
  /** An app line with more than one process can be opened. */
  expandable: boolean;
  expanded: boolean;
  /** A process line's process, or an app's only one. */
  process: ProcessRow | null;
  pid: number | null;
  user: string;
  /** All of it is the person's own. */
  own: boolean;
  kernel: boolean;
}

export interface LineOptions {
  /** By app (true) or every process on its own line. */
  grouped: boolean;
  /** The app keys opened. */
  expanded: ReadonlySet<string>;
  /** The search: an app found by one of its processes, not by its name, opens to show it. */
  query: string;
  columns: ReadonlyArray<SortableColumn<Line>>;
  sort: SortState | null;
}

/** Numbers that may be unknown add up what is known; unknown when none is. */
function sum(rows: readonly ProcessRow[], pick: (row: ProcessRow) => number | null): number | null {
  let total: number | null = null;
  for (const row of rows) {
    const value = pick(row);
    if (value !== null) total = (total ?? 0) + value;
  }
  return total;
}

function metrics(rows: readonly ProcessRow[]): Metrics {
  return {
    cpu: sum(rows, (row) => row.cpu) ?? 0,
    cpuTime: sum(rows, (row) => row.cpuTime) ?? 0,
    threads: sum(rows, (row) => row.threads) ?? 0,
    memory: sum(rows, (row) => row.memory) ?? 0,
    read: sum(rows, (row) => row.read),
    written: sum(rows, (row) => row.written),
    readRate: sum(rows, (row) => row.readRate),
    writeRate: sum(rows, (row) => row.writeRate),
    sockets: sum(rows, (row) => row.sockets),
    wakeups: sum(rows, (row) => row.wakeups),
    gpu: sum(rows, (row) => row.gpu),
    impact: sum(rows, (row) => row.impact) ?? 0,
  };
}

/** A process on its own line. */
export function processLine(row: ProcessRow, depth: 0 | 1, withIcon: boolean): Line {
  return {
    ...metrics([row]),
    key: `pid:${row.pid}`,
    kind: "process",
    name: row.name,
    icon: withIcon ? (row.app?.icon ?? null) : null,
    depth,
    members: [row],
    expandable: false,
    expanded: false,
    process: row,
    pid: row.pid,
    user: row.user,
    own: row.own,
    kernel: row.kernel,
  };
}

/** The processes an app was started as: those whose parent isn't one of its own (what Quit signals). */
export function appRoots(members: readonly ProcessRow[]): ProcessRow[] {
  const pids = new Set(members.map((row) => row.pid));
  return members.filter((row) => !pids.has(row.ppid));
}

function appLine(key: string, members: readonly ProcessRow[], expanded: boolean): Line {
  const first = members[0] as ProcessRow;
  const app = first.app ?? { key, name: first.name, icon: "" };
  const root = appRoots(members)[0] ?? first;
  const only = members.length === 1 ? first : null;
  return {
    ...metrics(members),
    key: `app:${key}`,
    kind: "app",
    name: app.name,
    icon: app.icon,
    depth: 0,
    members,
    expandable: members.length > 1,
    expanded: members.length > 1 && expanded,
    process: only,
    pid: only?.pid ?? null,
    user: root.user,
    own: members.every((row) => row.own),
    kernel: false,
  };
}

/** The lines for `rows`, sorted by `options.sort`: an opened app's processes follow it, sorted the same way. */
export function buildLines(rows: readonly ProcessRow[], options: LineOptions): Line[] {
  const { columns, sort } = options;
  if (!options.grouped)
    return sortRows(
      rows.map((row) => processLine(row, 0, true)),
      columns,
      sort,
    );
  const byApp = new Map<string, ProcessRow[]>();
  const alone: ProcessRow[] = [];
  for (const row of rows) {
    if (!row.app) {
      alone.push(row);
      continue;
    }
    const members = byApp.get(row.app.key);
    if (members) members.push(row);
    else byApp.set(row.app.key, [row]);
  }
  const q = options.query.trim().toLowerCase();
  const apps = [...byApp].map(([key, members]) => {
    const name = members[0]?.app?.name.toLowerCase() ?? "";
    return appLine(key, members, options.expanded.has(key) || (q !== "" && !name.includes(q)));
  });
  const top = sortRows([...apps, ...alone.map((row) => processLine(row, 0, false))], columns, sort);
  return top.flatMap((line) =>
    line.expanded
      ? [
          line,
          ...sortRows(
            line.members.map((row) => processLine(row, 1, false)),
            columns,
            sort,
          ),
        ]
      : [line],
  );
}

/** The app key of an app line ("app:<key>"), else null. */
export function appKeyOf(lineKey: string): string | null {
  return lineKey.startsWith("app:") ? lineKey.slice(4) : null;
}

/**
 * The line Return in the search field picks: the selection while the search
 * still shows it, else the first match. Return only selects; quitting is
 * always the Quit… button or ❖K, then the sheet.
 */
export function submitSelection(shown: readonly string[], selected: string | null): string | null {
  return selected !== null && shown.includes(selected) ? selected : (shown[0] ?? null);
}

/**
 * The line to select for an app the battery menu named: its key, else its
 * name (a window's app the reader matched differently), else null.
 */
export function lineForApp(lines: readonly Line[], app: { key: string; name?: string }): string | null {
  const byKey = lines.find((line) => line.key === `app:${app.key}`);
  if (byKey) return byKey.key;
  const lower = app.name?.toLowerCase();
  return (lower ? lines.find((line) => line.depth === 0 && line.name.toLowerCase() === lower)?.key : undefined) ?? null;
}

/** The app line a process line sits under (the nearest line above it at the top level); the line itself at the top. */
export function parentKey(lines: readonly Pick<Line, "key" | "depth">[], key: string): string {
  const at = lines.findIndex((line) => line.key === key);
  for (let index = at; index >= 0; index--) {
    const line = lines[index] as Pick<Line, "key" | "depth">;
    if (line.depth === 0) return line.key;
  }
  return key;
}
