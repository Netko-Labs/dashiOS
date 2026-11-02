/**
 * The strip under the table, as on the Mac: figures for the open tab on
 * either side of a graph of the last two minutes (CPU load, memory in use,
 * disk and network traffic).
 */

import { useColors, useSurface } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { formatBytes, formatCount, formatPercent, formatRate } from "./format.ts";
import { niceMax, sparkline, stacked } from "./graph.ts";
import type { MonitorState, Tab } from "./monitor.ts";

export const SUMMARY_HEIGHT = 132;
const GRAPH = { width: 260, height: 78 } as const;

/** Two colors for two series: the accent, and a blue (red for the CPU's system share, as on the Mac). */
const BLUE = "#3b82c4";

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
        <View key={figure.label} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {figure.color !== undefined && <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: figure.color }} />}
            <Text style={{ fontSize: 12, color: colors.textMuted }}>{`${figure.label}:`}</Text>
          </View>
          <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>{figure.value}</Text>
        </View>
      ))}
    </View>
  );
}

interface Series {
  values: readonly number[];
  color: string;
}

function Graph({ title, series, max }: { title: string; series: readonly Series[]; max: number }) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View style={{ width: GRAPH.width + 2, flexShrink: 0, flexDirection: "column", alignItems: "center", gap: 4 }}>
      <Text style={{ fontSize: 10, fontWeight: "semibold", color: colors.textMuted }}>{title}</Text>
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

export function Summary({ tab, state, processes }: { tab: Tab; state: MonitorState; processes: number }) {
  const colors = useColors();
  const surface = useSurface();
  const accent = colors.selection;
  let left: Figure[];
  let right: Figure[];
  let graph: { title: string; series: Series[]; max: number };
  switch (tab) {
    case "cpu":
      left = [
        { label: "System", value: `${formatPercent(state.cpu.system)}%`, color: colors.critical },
        { label: "User", value: `${formatPercent(state.cpu.user)}%`, color: accent },
        { label: "Idle", value: `${formatPercent(state.cpu.idle)}%` },
      ];
      right = [
        { label: "Threads", value: formatCount(state.threads) },
        { label: "Processes", value: formatCount(processes) },
        { label: "CPUs", value: formatCount(state.cpus) },
      ];
      graph = {
        title: "CPU LOAD",
        max: 100,
        series: [
          { values: stacked(state.cpuHistory.system, state.cpuHistory.user), color: accent },
          { values: state.cpuHistory.system, color: colors.critical },
        ],
      };
      break;
    case "memory": {
      const memory = state.memory;
      const used = memory ? memory.total - memory.available : 0;
      left = [
        { label: "Physical Memory", value: memory ? formatBytes(memory.total) : "—" },
        { label: "Memory Used", value: memory ? formatBytes(used) : "—", color: accent },
        { label: "Cached Files", value: memory ? formatBytes(memory.cached) : "—" },
      ];
      right = [
        { label: "Available", value: memory ? formatBytes(memory.available) : "—" },
        { label: "Swap Used", value: memory ? formatBytes(memory.swapTotal - memory.swapFree) : "—" },
        { label: "Swap Size", value: memory ? formatBytes(memory.swapTotal) : "—" },
      ];
      graph = { title: "MEMORY USED", max: 100, series: [{ values: state.memoryHistory, color: accent }] };
      break;
    }
    case "disk": {
      const { totals, perSecond, history } = state.disk;
      left = [
        { label: "Reads in", value: formatCount(totals.readOps) },
        { label: "Writes out", value: formatCount(totals.writeOps) },
        { label: "Reads in/sec", value: formatCount(perSecond.readOps) },
        { label: "Writes out/sec", value: formatCount(perSecond.writeOps) },
      ];
      right = [
        { label: "Data read", value: formatBytes(totals.readBytes) },
        { label: "Data written", value: formatBytes(totals.writeBytes) },
        { label: "Data read/sec", value: formatRate(perSecond.readBytes), color: BLUE },
        { label: "Data written/sec", value: formatRate(perSecond.writeBytes), color: accent },
      ];
      graph = {
        title: "DATA",
        max: niceMax([...history.read, ...history.write], 64 * 1024),
        series: [
          { values: history.read, color: BLUE },
          { values: history.write, color: accent },
        ],
      };
      break;
    }
    case "network": {
      const { totals, perSecond, history } = state.net;
      left = [
        { label: "Packets in", value: formatCount(totals.packetsIn) },
        { label: "Packets out", value: formatCount(totals.packetsOut) },
        { label: "Packets in/sec", value: formatCount(perSecond.packetsIn) },
        { label: "Packets out/sec", value: formatCount(perSecond.packetsOut) },
      ];
      right = [
        { label: "Data received", value: formatBytes(totals.bytesIn) },
        { label: "Data sent", value: formatBytes(totals.bytesOut) },
        { label: "Data received/sec", value: formatRate(perSecond.bytesIn), color: BLUE },
        { label: "Data sent/sec", value: formatRate(perSecond.bytesOut), color: accent },
      ];
      graph = {
        title: "DATA",
        max: niceMax([...history.in, ...history.out], 16 * 1024),
        series: [
          { values: history.in, color: BLUE },
          { values: history.out, color: accent },
        ],
      };
      break;
    }
  }
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
      <Graph title={graph.title} series={graph.series} max={graph.max} />
      <Figures figures={right} testID="summary-right" />
    </View>
  );
}
