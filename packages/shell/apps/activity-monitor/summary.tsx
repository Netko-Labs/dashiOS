/**
 * The strip under the table (View › Show Summary hides it): figures for the
 * open tab on either side of a graph of the last minutes (CPU load, memory
 * used, energy impact, disk and network activity), each graph's scale at its
 * top. The labels share one edge (a swatch's slot is kept on every row of a
 * column that has one) and the values another. The graph's place is pinned,
 * the same on every tab, and it narrows before a figure is cut. In a short
 * window the strip is one line of the tab's main figures and no graph.
 * Processes and threads are counted as the View menu shows them: kernel
 * threads only when they are shown. On Energy it says in words which app is
 * using the most.
 */

import { useColors, useSurface } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { sparkline } from "./graph.ts";
import type { Line } from "./lines.ts";
import type { MonitorState, Tab } from "./monitor.ts";
import { briefFigures, content, type Figure, type GraphSpec } from "./summary-figures.ts";

export const SUMMARY_HEIGHT = 132;
/** The strip as one line of figures, in a window shorter than `SHORT_WINDOW`. */
export const SUMMARY_BRIEF_HEIGHT = 36;
export const SHORT_WINDOW = 480;
/** The graph's drawing: as wide as `graphWidth` leaves it, between `min` and `max`. */
const GRAPH = { max: 260, min: 120, height: 74 } as const;
/** Above the graph's box: its title row and the gap under it. */
const GRAPH_HEAD = 19;
/** The strip's sides, the room between its three parts, and the least a figure column keeps. */
const STRIP = { side: 20, gap: 24, figures: 150 } as const;
/** One figure's row: 4 rows fill the graph's box. */
const FIGURE_ROW = 19;

/** The graph's width in a strip `width` wide: what the two figure columns leave, kept between GRAPH.min and GRAPH.max. */
export function graphWidth(width: number): number {
  const left = width - 2 * STRIP.side - 2 * STRIP.gap - 2 * STRIP.figures;
  return Math.max(GRAPH.min, Math.min(GRAPH.max, Math.floor(left)));
}

function Figures({ figures, testID }: { figures: readonly Figure[]; testID: string }) {
  const colors = useColors();
  const swatches = figures.some((figure) => figure.color !== undefined);
  return (
    // Centred on the graph's box, whatever the tab: the labels in one column, the values in another.
    <View testID={testID} style={{ flex: 1, minWidth: 0, height: GRAPH.height + 2, marginTop: GRAPH_HEAD, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ flexShrink: 0, flexDirection: "column" }}>
        {figures.map((figure) => (
          <View key={figure.label} style={{ height: FIGURE_ROW, flexDirection: "row", alignItems: "center", gap: 6 }}>
            {swatches && <View style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 2, backgroundColor: figure.color ?? "#00000000" }} />}
            <View style={{ flexShrink: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
                {figure.label}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexShrink: 1, minWidth: 0, flexDirection: "column" }}>
        {figures.map((figure) => (
          <View key={figure.label} style={{ height: FIGURE_ROW, justifyContent: "center", minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>
              {figure.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The short window's strip: a few figures on one line, each label before its value. */
function Brief({ figures }: { figures: readonly Figure[] }) {
  const colors = useColors();
  return (
    <View testID="summary-brief" style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 20 }}>
      {figures.map((figure) => (
        <View key={figure.label} style={{ flexShrink: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
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

function Graph({ title, series, max, scale, width }: GraphSpec & { width: number }) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View testID="summary-graph" style={{ width: width + 2, flexShrink: 0, flexDirection: "column", gap: 4 }}>
      <View style={{ height: GRAPH_HEAD - 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>{title}</Text>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{scale}</Text>
      </View>
      <View
        style={{
          width: width + 2,
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
            <Svg markup={sparkline(each.values, max, width, GRAPH.height)} width={width} height={GRAPH.height} color={each.color} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** The strip's height: one line in a window shorter than `SHORT_WINDOW`. */
export const summaryHeight = (windowHeight: number): number => (windowHeight < SHORT_WINDOW ? SUMMARY_BRIEF_HEIGHT : SUMMARY_HEIGHT);

export function Summary({
  tab,
  state,
  totals,
  top,
  width,
  height,
}: {
  tab: Tab;
  state: MonitorState;
  totals: { processes: number; threads: number };
  top: Line | null;
  /** The window's size: the graph narrows with its width, and a short one gets the one-line strip. */
  width: number;
  height: number;
}) {
  const colors = useColors();
  const surface = useSurface();
  const { left, right, graph } = content(tab, state, totals, top);
  const brief = height < SHORT_WINDOW;
  return (
    <View
      testID="summary"
      style={{
        height: summaryHeight(height),
        flexShrink: 0,
        flexDirection: "row",
        // Pinned from the top, not centred: the graph sits at one height on every tab.
        alignItems: brief ? "center" : "flex-start",
        paddingTop: brief ? 0 : (SUMMARY_HEIGHT - GRAPH_HEAD - GRAPH.height - 2) / 2 - 1,
        gap: STRIP.gap,
        paddingHorizontal: STRIP.side,
        borderTopWidth: 1,
        borderColor: colors.separator,
        backgroundColor: surface.window,
      }}
    >
      {brief ? (
        <Brief figures={briefFigures(tab, [...left, ...right])} />
      ) : (
        <>
          <Figures figures={left} testID="summary-left" />
          <Graph {...graph} width={graphWidth(width)} />
          <Figures figures={right} testID="summary-right" />
        </>
      )}
    </View>
  );
}
