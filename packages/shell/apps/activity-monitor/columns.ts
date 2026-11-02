/** The table's columns on each tab, and the sort each tab opens with. */

import { type Column, type SortState } from "@dashi/ui";
import { formatBytes, formatCount, formatCpuTime, formatPercent } from "./format.ts";
import type { Tab } from "./monitor.ts";
import type { ProcessRow } from "./sample.ts";

type ProcessColumn = Column<ProcessRow>;

const optional = (value: number | null, format: (n: number) => string): string => (value === null ? "—" : format(value));

const NAME: ProcessColumn = { key: "name", title: "Process Name", text: (row) => row.name };
const CPU: ProcessColumn = {
  key: "cpu",
  title: "% CPU",
  width: 72,
  align: "right",
  descendingFirst: true,
  text: (row) => formatPercent(row.cpu),
  sortValue: (row) => row.cpu,
};
const CPU_TIME: ProcessColumn = {
  key: "cpuTime",
  title: "CPU Time",
  width: 92,
  align: "right",
  descendingFirst: true,
  text: (row) => formatCpuTime(row.cpuTime),
  sortValue: (row) => row.cpuTime,
};
const THREADS: ProcessColumn = {
  key: "threads",
  title: "Threads",
  width: 72,
  align: "right",
  descendingFirst: true,
  text: (row) => formatCount(row.threads),
  sortValue: (row) => row.threads,
};
const MEMORY: ProcessColumn = {
  key: "memory",
  title: "Memory",
  width: 96,
  align: "right",
  descendingFirst: true,
  text: (row) => formatBytes(row.memory),
  sortValue: (row) => row.memory,
};
const WRITTEN: ProcessColumn = {
  key: "written",
  title: "Bytes Written",
  width: 112,
  align: "right",
  descendingFirst: true,
  text: (row) => optional(row.written, formatBytes),
  sortValue: (row) => row.written ?? -1,
};
const READ: ProcessColumn = {
  key: "read",
  title: "Bytes Read",
  width: 104,
  align: "right",
  descendingFirst: true,
  text: (row) => optional(row.read, formatBytes),
  sortValue: (row) => row.read ?? -1,
};
const SOCKETS: ProcessColumn = {
  key: "sockets",
  title: "Sockets",
  width: 80,
  align: "right",
  descendingFirst: true,
  text: (row) => optional(row.sockets, formatCount),
  sortValue: (row) => row.sockets ?? -1,
};
const PID: ProcessColumn = { key: "pid", title: "PID", width: 72, align: "right", text: (row) => String(row.pid), sortValue: (row) => row.pid };
const USER: ProcessColumn = { key: "user", title: "User", width: 112, text: (row) => row.user };

export const COLUMNS: Record<Tab, readonly ProcessColumn[]> = {
  cpu: [NAME, CPU, CPU_TIME, THREADS, PID, USER],
  memory: [NAME, MEMORY, THREADS, PID, USER],
  disk: [NAME, WRITTEN, READ, PID, USER],
  network: [NAME, SOCKETS, PID, USER],
};

export const DEFAULT_SORT: Record<Tab, SortState> = {
  cpu: { key: "cpu", ascending: false },
  memory: { key: "memory", ascending: false },
  disk: { key: "written", ascending: false },
  network: { key: "sockets", ascending: false },
};
