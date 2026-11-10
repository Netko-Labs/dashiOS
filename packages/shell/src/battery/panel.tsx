/**
 * The battery panel (docs/design.html, "The battery"): what the menu bar's
 * battery item and Control Center's battery row open, in place of the old
 * text menu. The charge and what it is doing, a gauge with the charge limit
 * on its tick, the last 24 hours as a named and scaled line with the limit
 * dashed, where the watts go in rows that add up (panel-numbers.ts), then
 * what the laptop adds (a one-time full charge, the graphics card's holders,
 * what keeps the computer awake) and Battery Settings. No power modes: they
 * are Control Center's. An app's row opens it in Activity Monitor.
 */

import { tintFor } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { MenuEntry, StatusMenuAction } from "../menus/index.ts";
import { useControlColors, usePanelEdge } from "../shared/controls/palette.ts";
import { LimitBar } from "../shared/controls/parts.tsx";
import { formatTime, useClockPrefs } from "../shared/time/clock.ts";
import type { Battery } from "../system/battery.ts";
import { chargeLine } from "./chart.ts";
import type { BatteryMonitorState } from "./monitor.ts";
import { formatWatts, idleFloor, type PowerRow, statusLine, wattRows } from "./panel-numbers.ts";

/** 300 wide, radius 26, 12 in. */
export const BATTERY_PANEL = { width: 300, radius: 26, padding: 12 } as const;

const CHART = { width: BATTERY_PANEL.width - 2 * BATTERY_PANEL.padding - 24, height: 46 } as const;

export interface BatteryPanelProps {
  battery: Battery;
  /** The monitor's draw, history and apps; null without it (the rows and the line are left out). */
  use: BatteryMonitorState | null;
  /** The charge limit in percent; null without one. */
  limit: number | null;
  /** What the laptop adds below the watts (laptop/menu.ts, inhibit/menu.ts), as menu rows. */
  extras: readonly MenuEntry<StatusMenuAction>[];
  /** Seconds since the epoch: the line's right end. */
  now: number;
  onApp: (app: { key: string; name: string }) => void;
  onAction: (action: StatusMenuAction) => void;
  onSettings: () => void;
}

function Rows({ children, testID }: { children: ReactNode; testID: string }) {
  const colors = useControlColors();
  return (
    <View
      testID={testID}
      style={{ marginTop: 8, borderRadius: 20, backgroundColor: colors.off, paddingLeft: 14, paddingRight: 14, paddingTop: 4, paddingBottom: 4 }}
    >
      {children}
    </View>
  );
}

function Line({ row, last, onApp }: { row: PowerRow; last: boolean; onApp: (app: { key: string; name: string }) => void }) {
  const colors = useControlColors();
  const app = row.app;
  return (
    <View
      testID={`battery-row:${row.key}`}
      {...(app ? { onPress: () => onApp(app) } : {})}
      style={{ flexDirection: "row", alignItems: "center", gap: 9, height: 34, borderBottomWidth: last ? 0 : 1, borderColor: colors.line }}
    >
      {/* A swatch for an app and for the rest of what the machine draws; the charging rows have none. */}
      {(app || row.key === "other") && <View style={{ width: 18, height: 18, borderRadius: 5, backgroundColor: app ? tintFor(app.name) : colors.line }} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 12.5,
            fontWeight: row.kind === "total" ? "semibold" : "normal",
            color: row.kind === "other" && !app ? colors.muted : colors.offInk,
          }}
        >
          {row.label}
        </Text>
      </View>
      <Text style={{ fontSize: 11.5, fontWeight: row.kind === "total" ? "semibold" : "normal", color: colors.offInk }}>{formatWatts(row.watts)}</Text>
    </View>
  );
}

export function BatteryPanel({ battery, use, limit, extras, now, onApp, onAction, onSettings }: BatteryPanelProps) {
  const colors = useControlColors();
  const edge = usePanelEdge(BATTERY_PANEL.padding);
  const clock = useClockPrefs();
  const rows = use
    ? wattRows({ battery, watts: use.watts, floor: idleFloor(use.samples), apps: use.apps, significant: use.significant, adapter: use.adapter })
    : [];
  const samples = use?.samples ?? [];
  const items = extras.flatMap((entry) => (entry.kind === "item" ? [entry] : []));
  return (
    <View
      testID="battery-panel"
      style={{
        width: BATTERY_PANEL.width,
        flexDirection: "column",
        borderRadius: BATTERY_PANEL.radius,
        backgroundColor: colors.surface,
        shadow: "xl",
        ...edge,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 14 }}>
        <Text style={{ fontSize: 28, fontWeight: "semibold", color: colors.text }}>{`${battery.percent}%`}</Text>
        <View testID="battery-status" style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 12, color: colors.muted }}>{statusLine(battery, limit)}</Text>
        </View>
      </View>
      <View testID="battery-gauge" style={{ flexDirection: "row", marginTop: 14, marginLeft: 6, marginRight: 6 }}>
        <LimitBar percent={battery.percent} limit={limit} height={12} label />
      </View>
      {samples.length > 0 && (
        <View
          testID="battery-line"
          style={{ marginTop: 10, borderRadius: 20, backgroundColor: colors.off, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10 }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
            <Text style={{ fontSize: 11, color: colors.muted }}>Charge, last 24 h</Text>
            <Text style={{ fontSize: 11, color: colors.muted }}>{`${battery.percent}%`}</Text>
          </View>
          <Svg markup={chargeLine(samples, { ...CHART, now }, limit)} width={CHART.width} height={CHART.height} color={colors.offInk} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
            <Text style={{ fontSize: 10, color: colors.muted }}>{`yesterday ${formatTime(new Date((now - 24 * 3600) * 1000), clock)}`}</Text>
            <Text style={{ fontSize: 10, color: colors.muted }}>{limit !== null && limit < 100 ? "0–100%, limit dashed" : "0–100%"}</Text>
            <Text style={{ fontSize: 10, color: colors.muted }}>now</Text>
          </View>
        </View>
      )}
      {rows.length > 0 && (
        <Rows testID="battery-watts">
          {rows.map((row, at) => (
            <Line key={row.key} row={row} last={at === rows.length - 1} onApp={onApp} />
          ))}
        </Rows>
      )}
      {items.length > 0 && (
        <Rows testID="battery-extras">
          {items.map((item, at) => {
            const action = item.action;
            return (
              <View
                // The rows never reorder while the panel is open.
                key={at}
                testID={`battery-extra:${at}`}
                {...(action ? { onPress: () => onAction(action) } : {})}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 9,
                  minHeight: 34,
                  borderBottomWidth: at === items.length - 1 ? 0 : 1,
                  borderColor: colors.line,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 12.5, color: action ? colors.offInk : colors.muted }}>{item.label.trim()}</Text>
                </View>
                {item.keys && <Text style={{ fontSize: 11.5, fontWeight: "semibold", color: colors.offInk }}>{item.keys}</Text>}
              </View>
            );
          })}
        </Rows>
      )}
      <View
        testID="battery-settings"
        onPress={onSettings}
        accessibilityRole="button"
        style={{ marginTop: 8, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: colors.line, alignItems: "center", justifyContent: "center" }}
      >
        <Text style={{ fontSize: 12.5, fontWeight: "semibold", color: colors.text }}>Battery Settings</Text>
      </View>
    </View>
  );
}
