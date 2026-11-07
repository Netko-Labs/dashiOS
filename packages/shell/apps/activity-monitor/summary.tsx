/**
 * The strip under the table (View › Show Summary hides it): figures for the
 * open tab on either side of a graph of the last minutes (CPU load, memory
 * used, energy impact, disk and network activity), each graph's scale at its
 * top. Each figure's value follows its label. Processes and threads are
 * counted as the View menu shows them: kernel threads only when they are
 * shown. On Energy it says in words which app is using the most.
 */

import { TINTS, useColors, useSurface } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { formatBytes, formatCount, formatPercent, formatRate } from "./format.ts";
import { niceMax, sparkline, stacked } from "./graph.ts";
import type { Line } from "./lines.ts";
import type { MonitorState, Tab } from "./monitor.ts";

export const SUMMARY_HEIGHT = 132;
const GRAPH = { width: 260, height: 74 } as const;

/**
 * Two colors for two series, from Dashi's tints (CO-4): never a job color, so
 * the CPU's system share isn't an error and a busy disk isn't "selected".
 */
const SERIES = { first: TINTS.mizu, second: TINTS.kabocha } as const;

interface Figure {
  label: string;
  value: string;
  /** A swatch of the series it describes. */
  color?: string;
}

function Figures({ figures, testID }: { figures: readonly Figure[]; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flex: 1, flexDirection: "column", justifyContent: "center", alignItems: "stretch", gap: 5, minWidth: 0 }}>
      {figures.map((figure) => (
        <View key={figure.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {figure.color !== undefined && <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: figure.color }} />}
          <View style={{ flexShrink: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
              {figure.label}
            </Text>
          </View>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>
              {figure.value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

interface Series {
  values: readonly number[];
  color: string;
}

interface GraphSpec {
  title: string;
  series: Series[];
  max: number;
  /** What the top line stands for ("100%", "2 MB/s"). */
  scale: string;
}

function Graph({ title, series, max, scale }: GraphSpec) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View style={{ width: GRAPH.width + 2, flexShrink: 0, flexDirection: "column", gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>{title}</Text>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{scale}</Text>
      </View>
      <View
        style={{
          width: GRAPH.width + 2,
          height: GRAPH.height + 2,
          position: "relative",
          borderWidth: 1,
          borderColor: colors.separator,
          borderRadius: 4,
          backgroundColor: surface.field,
          overflow: "hidden",
        }}
      >
        {[0.25, 0.5, 0.75].map((at) => (
          <View
            key={at}
            style={{ position: "absolute", left: 0, right: 0, top: Math.round(GRAPH.height * at), height: 1, backgroundColor: colors.separator }}
          />
        ))}
        {series.map((each, index) => (
          <View key={index} style={{ position: "absolute", left: 0, top: 0 }}>
            <Svg markup={sparkline(each.values, max, GRAPH.width, GRAPH.height)} width={GRAPH.width} height={GRAPH.height} color={each.color} />
          </View>
        ))}
      </View>
    </View>
  );
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

function content(
  tab: Tab,
  state: MonitorState,
  totals: { processes: number; threads: number },
  top: Line | null,
): { left: Figure[]; right: Figure[]; graph: GraphSpec } {
  switch (tab) {
    case "cpu":
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
    case "memory": {
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
    case "energy": {
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
    case "disk": {
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
    case "network": {
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
  }
}

export function Summary({ tab, state, totals, top }: { tab: Tab; state: MonitorState; totals: { processes: number; threads: number }; top: Line | null }) {
  const colors = useColors();
  const surface = useSurface();
  const { left, right, graph } = content(tab, state, totals, top);
  return (
    <View
      testID="summary"
      style={{
        height: SUMMARY_HEIGHT,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 28,
        paddingHorizontal: 24,
        borderTopWidth: 1,
        borderColor: colors.separator,
        backgroundColor: surface.window,
      }}
    >
      <Figures figures={left} testID="summary-left" />
      <Graph {...graph} />
      <Figures figures={right} testID="summary-right" />
    </View>
  );
}
