/**
 * The table's columns on each tab, and the sort each tab opens with. A line
 * is an app or a process (lines.ts); an app's numbers are its processes'
 * added up. The name column's cell (the icon and the disclosure) is drawn by
 * the view; here it is only words.
 */

import type { Column, SortState } from "@dashi/ui";
import { formatBytes, formatCount, formatCpuTime, formatPercent, formatRate, formatState } from "./format.ts";
import type { Line } from "./lines.ts";
import type { Tab } from "./monitor.ts";

type LineColumn = Column<Line>;

const optional = (value: number | null, format: (n: number) => string): string => (value === null ? "—" : format(value));

export const NAME: LineColumn = { key: "name", title: "Name", text: (line) => line.name };
const CPU: LineColumn = {
  key: "cpu",
  title: "% CPU",
  width: 72,
  align: "right",
  descendingFirst: true,
  text: (line) => formatPercent(line.cpu),
  sortValue: (line) => line.cpu,
};
const CPU_TIME: LineColumn = {
  key: "cpuTime",
  title: "CPU time",
  width: 92,
  align: "right",
  descendingFirst: true,
  text: (line) => formatCpuTime(line.cpuTime),
  sortValue: (line) => line.cpuTime,
};
const THREADS: LineColumn = {
  key: "threads",
  title: "Threads",
  width: 72,
  align: "right",
  descendingFirst: true,
  text: (line) => formatCount(line.threads),
  sortValue: (line) => line.threads,
};
const STATE: LineColumn = {
  key: "state",
  title: "State",
  width: 84,
  text: (line) => (line.process && line.kind === "process" ? formatState(line.process.state) : ""),
};
const MEMORY: LineColumn = {
  key: "memory",
  title: "Memory",
  width: 96,
  align: "right",
  descendingFirst: true,
  text: (line) => formatBytes(line.memory),
  sortValue: (line) => line.memory,
};
const WRITE_RATE: LineColumn = {
  key: "writeRate",
  title: "Written/s",
  width: 104,
  align: "right",
  descendingFirst: true,
  text: (line) => optional(line.writeRate, formatRate),
  sortValue: (line) => line.writeRate ?? -1,
};
const READ_RATE: LineColumn = {
  key: "readRate",
  title: "Read/s",
  width: 104,
  align: "right",
  descendingFirst: true,
  text: (line) => optional(line.readRate, formatRate),
  sortValue: (line) => line.readRate ?? -1,
};
const WRITTEN: LineColumn = {
  key: "written",
  title: "Written",
  width: 104,
  align: "right",
  descendingFirst: true,
  text: (line) => optional(line.written, formatBytes),
  sortValue: (line) => line.written ?? -1,
};
const READ: LineColumn = {
  key: "read",
  title: "Read",
  width: 104,
  align: "right",
  descendingFirst: true,
  text: (line) => optional(line.read, formatBytes),
  sortValue: (line) => line.read ?? -1,
};
const SOCKETS: LineColumn = {
  key: "sockets",
  title: "Sockets",
  width: 80,
  align: "right",
  descendingFirst: true,
  text: (line) => optional(line.sockets, formatCount),
  sortValue: (line) => line.sockets ?? -1,
};
const IMPACT: LineColumn = {
  key: "impact",
  title: "Energy impact",
  width: 112,
  align: "right",
  descendingFirst: true,
  text: (line) => formatPercent(line.impact),
  sortValue: (line) => line.impact,
};
const GPU: LineColumn = {
  key: "gpu",
  title: "% GPU",
  width: 72,
  align: "right",
  descendingFirst: true,
  text: (line) => optional(line.gpu, formatPercent),
  sortValue: (line) => line.gpu ?? -1,
};
const WAKEUPS: LineColumn = {
  key: "wakeups",
  title: "Wakeups/s",
  width: 96,
  align: "right",
  descendingFirst: true,
  text: (line) => optional(line.wakeups, formatCount),
  sortValue: (line) => line.wakeups ?? -1,
};
const PID: LineColumn = {
  key: "pid",
  title: "PID",
  width: 72,
  align: "right",
  text: (line) => (line.pid === null ? "" : String(line.pid)),
  sortValue: (line) => line.pid ?? -1,
};
const USER: LineColumn = { key: "user", title: "User", width: 112, text: (line) => line.user };

export const COLUMNS: Record<Tab, readonly LineColumn[]> = {
  cpu: [NAME, CPU, CPU_TIME, THREADS, STATE, PID, USER],
  memory: [NAME, MEMORY, THREADS, PID, USER],
  // Energy impact is % CPU, % GPU and wakeups together (energy-proc.ts); its parts follow.
  energy: [NAME, IMPACT, CPU, GPU, WAKEUPS, USER],
  // What is hitting the disk now first; the totals since each process started after.
  disk: [NAME, WRITE_RATE, READ_RATE, WRITTEN, READ, PID, USER],
  network: [NAME, SOCKETS, PID, USER],
};

export const DEFAULT_SORT: Record<Tab, SortState> = {
  cpu: { key: "cpu", ascending: false },
  memory: { key: "memory", ascending: false },
  energy: { key: "impact", ascending: false },
  disk: { key: "writeRate", ascending: false },
  network: { key: "sockets", ascending: false },
};

/** The least room a name keeps: the chevron, the icon, about fifteen letters and the process count. */
export const NAME_MIN = 180;
/** The table's own padding either side of its cells (dashi-ui table.tsx `PAD`). */
const TABLE_PAD = 10;

/** Which columns give way first when the window is too narrow for them and a name, per tab: the name's neighbours stay longest. */
const GIVE_WAY: Record<Tab, readonly string[]> = {
  cpu: ["user", "state", "pid", "cpuTime", "threads"],
  memory: ["user", "pid", "threads"],
  energy: ["user", "gpu", "wakeups", "cpu"],
  disk: ["user", "pid", "read", "written", "readRate"],
  network: ["user", "pid"],
};

/**
 * The columns that fit a table `width` wide while the name keeps `NAME_MIN`:
 * the tab's columns, dropping the least needed first (`GIVE_WAY`), never the
 * name, the first figure, or the column the list is sorted by.
 */
export function fitColumns<C extends { key: string; width?: number }>(tab: Tab, columns: readonly C[], width: number, sortKey: string | null = null): C[] {
  const room = width - TABLE_PAD;
  let kept = [...columns];
  const fixed = (): number => kept.reduce((sum, column) => sum + (column.width ?? 0), 0);
  for (const key of GIVE_WAY[tab]) {
    if (room - fixed() >= NAME_MIN) break;
    if (key !== sortKey) kept = kept.filter((column) => column.key !== key);
  }
  return kept;
}
