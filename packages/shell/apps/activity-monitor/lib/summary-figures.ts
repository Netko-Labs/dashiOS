/**
 * The summary's figures and graph for each tab, as data: the figures beside
 * the graph, the series it draws, and the few a short window's one line
 * keeps. summary.tsx lays them out.
 */

import { TINTS } from "@dashi/ui";
import { formatBytes, formatCount, formatPercent, formatRate } from "./format.ts";
import { niceMax, stacked } from "./graph.ts";
import type { Line } from "./lines.ts";
import type { MonitorState, Tab } from "./monitor.ts";

/**
 * Two colors for two series, from Dashi's tints (CO-4): never a job color, so
 * the CPU's system share isn't an error and a busy disk isn't "selected".
 */
const SERIES = { first: TINTS.mizu, second: TINTS.kabocha } as const;

export interface Figure {
  label: string;
  value: string;
  /** A swatch of the series it describes. */
  color?: string;
}

export interface Series {
  values: readonly number[];
  color: string;
}

export interface GraphSpec {
  title: string;
  series: Series[];
  max: number;
  /** What the top line stands for ("100%", "2 MB/s"). */
  scale: string;
}

/** A rate graph's top, as its scale says it. */
function rateGraph(title: string, first: readonly number[], second: readonly number[], floor: number): GraphSpec {
  const max = niceMax([...first, ...second], floor);
  return {
    title,
    max,
    scale: formatRate(max),
    series: [
      { values: first, color: SERIES.second },
      { values: second, color: SERIES.first },
    ],
  };
}

type Totals = { processes: number; threads: number };
type Content = { left: Figure[]; right: Figure[]; graph: GraphSpec };

function cpuContent(state: MonitorState, totals: Totals): Content {
  return {
    left: [
      { label: "System", value: `${formatPercent(state.cpu.system)}%`, color: SERIES.second },
      { label: "User", value: `${formatPercent(state.cpu.user)}%`, color: SERIES.first },
      { label: "Idle", value: `${formatPercent(state.cpu.idle)}%` },
    ],
    right: [
      { label: "Threads", value: formatCount(totals.threads) },
      { label: "Processes", value: formatCount(totals.processes) },
      { label: "Cores", value: formatCount(state.cpus) },
    ],
    graph: {
      // Of all the cores together; a process's % CPU is of one core.
      title: "CPU load",
      max: 100,
      scale: "100%",
      series: [
        { values: stacked(state.cpuHistory.system, state.cpuHistory.user), color: SERIES.first },
        { values: state.cpuHistory.system, color: SERIES.second },
      ],
    },
  };
}

function memoryContent(state: MonitorState): Content {
  const memory = state.memory;
  const known = (format: (m: NonNullable<typeof memory>) => string): string => (memory ? format(memory) : "—");
  return {
    left: [
      { label: "Memory", value: known((m) => formatBytes(m.total)) },
      { label: "Used", value: known((m) => formatBytes(m.total - m.available)), color: SERIES.first },
      { label: "Cached files", value: known((m) => formatBytes(m.cached)) },
    ],
    right: [
      { label: "Available", value: known((m) => formatBytes(m.available)) },
      { label: "Swap used", value: known((m) => formatBytes(m.swapTotal - m.swapFree)) },
      { label: "Swap size", value: known((m) => formatBytes(m.swapTotal)) },
    ],
    graph: { title: "Memory used", max: 100, scale: "100%", series: [{ values: state.memoryHistory, color: SERIES.first }] },
  };
}

function energyContent(state: MonitorState, totals: Totals, top: Line | null): Content {
  const { impact, wakeups, gpu, history } = state.energy;
  const max = niceMax(history, 10);
  return {
    left: [
      { label: "Energy impact", value: formatPercent(impact), color: SERIES.first },
      { label: "Wakeups/s", value: wakeups === null ? "—" : formatCount(wakeups) },
      { label: "% GPU", value: gpu === null ? "—" : formatPercent(gpu) },
    ],
    right: [
      { label: "Most energy", value: top && top.impact >= 1 ? top.name : "Nothing much" },
      { label: "Processes", value: formatCount(totals.processes) },
      { label: "Threads", value: formatCount(totals.threads) },
    ],
    graph: { title: "Energy impact", max, scale: formatCount(max), series: [{ values: history, color: SERIES.first }] },
  };
}

function diskContent(state: MonitorState): Content {
  const { totals: disk, perSecond, history } = state.disk;
  return {
    left: [
      { label: "Reads", value: formatCount(disk.readOps) },
      { label: "Writes", value: formatCount(disk.writeOps) },
      { label: "Reads/s", value: formatCount(perSecond.readOps) },
      { label: "Writes/s", value: formatCount(perSecond.writeOps) },
    ],
    right: [
      { label: "Data read", value: formatBytes(disk.readBytes) },
      { label: "Data written", value: formatBytes(disk.writeBytes) },
      { label: "Read/s", value: formatRate(perSecond.readBytes), color: SERIES.second },
      { label: "Written/s", value: formatRate(perSecond.writeBytes), color: SERIES.first },
    ],
    graph: rateGraph("Disk activity", history.read, history.write, 64 * 1024),
  };
}

function networkContent(state: MonitorState): Content {
  const { totals: net, perSecond, history } = state.net;
  return {
    left: [
      { label: "Packets in", value: formatCount(net.packetsIn) },
      { label: "Packets out", value: formatCount(net.packetsOut) },
      { label: "Packets in/s", value: formatCount(perSecond.packetsIn) },
      { label: "Packets out/s", value: formatCount(perSecond.packetsOut) },
    ],
    right: [
      { label: "Received", value: formatBytes(net.bytesIn) },
      { label: "Sent", value: formatBytes(net.bytesOut) },
      { label: "Received/s", value: formatRate(perSecond.bytesIn), color: SERIES.second },
      { label: "Sent/s", value: formatRate(perSecond.bytesOut), color: SERIES.first },
    ],
    graph: rateGraph("Network activity", history.in, history.out, 16 * 1024),
  };
}

export function content(tab: Tab, state: MonitorState, totals: Totals, top: Line | null): Content {
  switch (tab) {
    case "cpu":
      return cpuContent(state, totals);
    case "memory":
      return memoryContent(state);
    case "energy":
      return energyContent(state, totals, top);
    case "disk":
      return diskContent(state);
    case "network":
      return networkContent(state);
  }
}

/** The figures a short window's one line keeps, by label, in order: the ones the graph would have shown. */
const BRIEF: Record<Tab, readonly string[]> = {
  cpu: ["System", "User", "Idle"],
  memory: ["Used", "Available", "Swap used"],
  energy: ["Energy impact", "Wakeups/s", "Most energy"],
  disk: ["Read/s", "Written/s", "Reads/s", "Writes/s"],
  network: ["Received/s", "Sent/s", "Packets in/s", "Packets out/s"],
};

/** A short window's figures for `tab`, out of the strip's two columns, without their swatches (there is no graph to match). */
export function briefFigures(tab: Tab, figures: readonly Figure[]): Figure[] {
  return BRIEF[tab].flatMap((label) => {
    const found = figures.find((figure) => figure.label === label);
    return found ? [{ label: found.label, value: found.value }] : [];
  });
}
