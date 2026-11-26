/**
 * The battery panel (docs/design.html, "The battery"): what the menu bar's
 * battery item and Control Center's battery row open, in place of the old
 * text menu. The charge and what it is doing, a gauge with the charge limit
 * on its tick, the last 24 hours as a named and scaled line with the limit
 * dashed, where the watts go in rows that add up (panel-numbers.ts), then
 * what the laptop adds (a one-time full charge, the graphics card's holders,
 * what keeps the computer awake) and Battery Settings…. No power modes: they
 * are Control Center's. An app's row opens it in Activity Monitor. It is
 * regular glass, radius 28, its rows on fills, the charge an ink reading
 * (frost-objects board 03, D781).
 */

import { Button, Frosted, LimitBar, RADIUS, SHADOW, SPACE, TYPE, tintFor, useControlColors, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { MenuEntry, StatusMenuAction } from "../../menus/index.ts";
import { useGlassPanelEdge } from "../../shared/glass/index.ts";
import { formatTime, useClockPrefs } from "../../shared/time/index.ts";
import type { Battery } from "../../system/battery.ts";
import { chargeLine } from "../chart.ts";
import type { BatteryMonitorState } from "../monitor.ts";
import { formatWatts, idleFloor, type PowerRow, statusLine, wattRows } from "../panel-numbers.ts";

/** 300 wide, radius 28 (the soft family, RA-2), 12 in; its cards 20 round, a row 34, an app's swatch 18. */
export const BATTERY_PANEL = { width: 300, radius: RADIUS.panel, padding: SPACE.inset, card: 20, row: 34, swatch: 18, gauge: 12 } as const;

const CHART = { width: BATTERY_PANEL.width - 2 * BATTERY_PANEL.padding - 2 * SPACE.inset, height: 46 } as const;

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
      style={{ marginTop: SPACE.m, borderRadius: BATTERY_PANEL.card, backgroundColor: colors.off, paddingHorizontal: SPACE.button, paddingVertical: SPACE.xs }}
    >
      {children}
    </View>
  );
}

/** A row of the watts; an app's opens it in Activity Monitor, a Tab stop named for it. */
function Line({ row, last, onApp }: { row: PowerRow; last: boolean; onApp: (app: { key: string; name: string }) => void }) {
  const colors = useControlColors();
  const app = row.app;
  return (
    <View
      testID={`battery-row:${row.key}`}
      {...(app
        ? { onPress: () => onApp(app), focusable: true, accessibilityRole: "menuitem" as const, accessibilityLabel: `${row.label}, ${formatWatts(row.watts)}` }
        : {})}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.m,
        height: BATTERY_PANEL.row,
        borderBottomWidth: last ? 0 : 1,
        borderColor: colors.line,
        focusRingColor: colors.focus,
      }}
    >
      {/* A swatch for an app and for the rest of what the machine draws; the charging rows have none. */}
      {(app || row.key === "other") && (
        <View
          style={{
            width: BATTERY_PANEL.swatch,
            height: BATTERY_PANEL.swatch,
            borderRadius: RADIUS.row,
            backgroundColor: app ? tintFor(app.name) : colors.line,
          }}
        />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: TYPE.panel.body.size,
            fontWeight: row.kind === "total" ? WEIGHT.semibold : WEIGHT.regular,
            color: row.kind === "other" && !app ? colors.muted : colors.offInk,
          }}
        >
          {row.label}
        </Text>
      </View>
      <Text style={{ fontSize: TYPE.panel.detail.size, fontWeight: row.kind === "total" ? WEIGHT.semibold : WEIGHT.regular, color: colors.offInk }}>
        {formatWatts(row.watts)}
      </Text>
    </View>
  );
}

/** The last 24 hours of charge as a line, named and scaled, the limit dashed. */
function ChargeLine({ battery, samples, limit, now }: { battery: Battery; samples: BatteryMonitorState["samples"]; limit: number | null; now: number }) {
  const colors = useControlColors();
  const clock = useClockPrefs();
  const small = { fontSize: TYPE.caption.size, color: colors.muted } as const;
  const axis = { fontSize: TYPE.panel.micro.size, color: colors.muted } as const;
  return (
    <View
      testID="battery-line"
      style={{
        marginTop: SPACE.gap,
        borderRadius: BATTERY_PANEL.card,
        backgroundColor: colors.off,
        paddingHorizontal: SPACE.inset,
        paddingVertical: SPACE.gap,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: SPACE.xs }}>
        <Text style={small}>Charge, last 24 h</Text>
        <Text style={small}>{`${battery.percent}%`}</Text>
      </View>
      <Svg markup={chargeLine(samples, { ...CHART, now }, limit)} width={CHART.width} height={CHART.height} color={colors.offInk} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: SPACE.xxs }}>
        <Text style={axis}>{`yesterday ${formatTime(new Date((now - 24 * 3600) * 1000), clock)}`}</Text>
        <Text style={axis}>{limit !== null && limit < 100 ? "0–100%, limit dashed" : "0–100%"}</Text>
        <Text style={axis}>now</Text>
      </View>
    </View>
  );
}

type ExtraItem = Extract<MenuEntry<StatusMenuAction>, { kind: "item" }>;

/** What the laptop adds, as rows: one with an action is pressed, one without only says. */
function Extras({ items, onAction }: { items: readonly ExtraItem[]; onAction: (action: StatusMenuAction) => void }) {
  const colors = useControlColors();
  return (
    <Rows testID="battery-extras">
      {items.map((item, at) => {
        const action = item.action;
        return (
          <View
            // The rows never reorder while the panel is open.
            key={at}
            testID={`battery-extra:${at}`}
            {...(action
              ? { onPress: () => onAction(action), focusable: true, accessibilityRole: "menuitem" as const, accessibilityLabel: item.label.trim() }
              : {})}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: SPACE.m,
              minHeight: BATTERY_PANEL.row,
              focusRingColor: colors.focus,
              borderBottomWidth: at === items.length - 1 ? 0 : 1,
              borderColor: colors.line,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: TYPE.panel.body.size, color: action ? colors.offInk : colors.muted }}>{item.label.trim()}</Text>
            </View>
            {item.keys && <Text style={{ fontSize: TYPE.panel.detail.size, fontWeight: WEIGHT.semibold, color: colors.offInk }}>{item.keys}</Text>}
          </View>
        );
      })}
    </Rows>
  );
}

/** The panel's glass; what is on it reads the glass palettes (`BatteryBody`). */
export function BatteryPanel(props: BatteryPanelProps) {
  const edge = useGlassPanelEdge(BATTERY_PANEL.padding);
  return (
    <Frosted
      level="regular"
      testID="battery-panel"
      style={{ width: BATTERY_PANEL.width, flexDirection: "column", borderRadius: BATTERY_PANEL.radius, shadow: SHADOW.xl, ...edge }}
    >
      <BatteryBody {...props} />
    </Frosted>
  );
}

function BatteryBody({ battery, use, limit, extras, now, onApp, onAction, onSettings }: BatteryPanelProps) {
  const colors = useControlColors();
  const rows = use
    ? wattRows({ battery, watts: use.watts, floor: idleFloor(use.samples), apps: use.apps, significant: use.significant, adapter: use.adapter })
    : [];
  const samples = use?.samples ?? [];
  const items = extras.flatMap((entry) => (entry.kind === "item" ? [entry] : []));
  return (
    <>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: SPACE.inset, paddingHorizontal: SPACE.s, paddingTop: SPACE.xs, paddingBottom: SPACE.button }}
      >
        <Text style={{ fontSize: TYPE.figure.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{`${battery.percent}%`}</Text>
        <View testID="battery-status" style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: TYPE.secondary.size, color: colors.muted }}>{statusLine(battery, limit)}</Text>
        </View>
      </View>
      <View testID="battery-gauge" style={{ flexDirection: "row", marginTop: SPACE.button, marginLeft: SPACE.s, marginRight: SPACE.s }}>
        <LimitBar percent={battery.percent} limit={limit} height={BATTERY_PANEL.gauge} label />
      </View>
      {samples.length > 0 && <ChargeLine battery={battery} samples={samples} limit={limit} now={now} />}
      {rows.length > 0 && (
        <Rows testID="battery-watts">
          {rows.map((row, at) => (
            <Line key={row.key} row={row} last={at === rows.length - 1} onApp={onApp} />
          ))}
        </Rows>
      )}
      {items.length > 0 && <Extras items={items} onAction={onAction} />}
      <View style={{ marginTop: SPACE.m, flexDirection: "row" }}>
        {/* It opens another window: an ellipsis (SH-32). */}
        <Button testID="battery-settings" look="panel" fill label="Battery Settings…" onPress={onSettings} />
      </View>
    </>
  );
}
