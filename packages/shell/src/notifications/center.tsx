/**
 * The notification center, macOS style: today's date and this month's
 * calendar (month-card.tsx), then the history by
 * app, the app with the newest notification first. A group shows its latest
 * notification with "N more" under it; that expands the rest. A click runs a
 * notification's `default` action (if it still has one and its app is still
 * on the bus) and closes the center, like a banner click; ✕ removes one,
 * "Clear All" a group or everything.
 */

import { useColors } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useMemo, useState } from "react";
import { calendarBridge } from "../calendar/bridge.ts";
import { MOON } from "../control-center/index.ts";
import { KeyCatcher } from "../overlay.tsx";
import { useMinuteClock } from "../shared/time/clock.ts";
import { Card, GroupHeader, hasDefaultAction, TextButton } from "./lib/center-parts.tsx";
import { dateHeading, groupByApp } from "./lib/group.ts";
import { MonthCard } from "./lib/month-card.tsx";
import { type NotificationStore, useNotifications } from "./store.ts";
import type { HistoryEntry } from "./types.ts";

export const NOTIFICATION_CENTER = { width: 380, padding: 12, gap: 10, radius: 18 } as const;

/** The air between the panel and the Dock (or the screen's edge). */
const CENTER_AIR = 8;

/** Where the panel ends above the screen's bottom edge: over the Dock's or the taskbar's zone, which stays visible under it. */
export const centerBottom = (dockInset: number): number => Math.max(0, dockInset) + CENTER_AIR;

export interface NotificationCenterProps {
  store: NotificationStore;
  onClose: () => void;
  /** Esc: closed, or back to the menu bar when the keyboard came from it (menus/bar-keys.ts). */
  onEscape?: () => void;
  /** How tall the Dock's zone at the screen's bottom is now (dock/presenter.ts `bottomInset`); 0 when it is hidden or autohides. */
  dockInset: number;
}

export function NotificationCenterPanel({ store, onClose, onEscape = onClose, dockInset }: NotificationCenterProps) {
  const colors = useColors();
  const { history, doNotDisturb } = useNotifications(store);
  const now = useMinuteClock();
  const groups = useMemo(() => groupByApp(history), [history]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const activate = (entry: HistoryEntry) => {
    // The center goes right away; whether the app answers is settled behind it.
    onClose();
    void store.activate(entry.id).then((ran) => {
      if (!ran) store.remove([entry.id]);
    });
  };

  return (
    <>
      <KeyCatcher onKey={(key) => key === "Escape" && onEscape()} />
      <View
        occlude
        testID="notification-center"
        style={{
          position: "absolute",
          right: 8,
          top: 2,
          // The Dock, when it takes room, stays visible under it.
          bottom: centerBottom(dockInset),
          width: NOTIFICATION_CENTER.width,
          flexDirection: "column",
          gap: NOTIFICATION_CENTER.gap,
          padding: NOTIFICATION_CENTER.padding,
          borderRadius: NOTIFICATION_CENTER.radius,
          // Solid, as the menus are: the menu's tint without its alpha, so a window under the empty half never ghosts through.
          backgroundColor: colors.menu.slice(0, 7),
          borderWidth: 1,
          borderColor: colors.menuEdge,
          shadow: "xl",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 24, paddingLeft: 4 }}>
          <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.text }}>{dateHeading(now)}</Text>
          {groups.length > 0 && <TextButton testID="nc-clear-all" label="Clear All" onPress={() => store.remove()} />}
        </View>
        <MonthCard
          now={now}
          onOpenDay={(day) => {
            // The center goes, as it does when a notification is opened.
            onClose();
            calendarBridge()?.openDay(day);
          }}
        />
        {doNotDisturb && (
          <View
            testID="nc-dnd"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              height: 28,
              paddingLeft: 10,
              borderRadius: 9,
              backgroundColor: colors.tile,
            }}
          >
            <Svg markup={MOON} size={13} color={colors.text} />
            <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>Do Not Disturb</Text>
          </View>
        )}
        {groups.length === 0 ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 15, fontWeight: "semibold", color: colors.textMuted }}>No Notifications</Text>
          </View>
        ) : (
          <ScrollView testID="nc-list" style={{ flex: 1 }}>
            <View style={{ flexDirection: "column", gap: 14 }}>
              {groups.map((group) => (
                <CenterGroup
                  key={group.key}
                  group={group}
                  open={expanded.has(group.key)}
                  now={now}
                  store={store}
                  onToggle={() => toggle(group.key)}
                  onActivate={activate}
                />
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </>
  );
}

type Group = ReturnType<typeof groupByApp>[number];

/** One app's notifications: its latest, and the rest behind "N more" until it opens. */
function CenterGroup({
  group,
  open,
  now,
  store,
  onToggle,
  onActivate,
}: {
  group: Group;
  open: boolean;
  now: Date;
  store: NotificationStore;
  onToggle: () => void;
  onActivate: (entry: HistoryEntry) => void;
}) {
  const [latest, ...older] = group.entries as [HistoryEntry, ...HistoryEntry[]];
  const shown = open ? group.entries : [latest];
  return (
    <View testID={`nc-group:${group.key}`} style={{ flexDirection: "column", gap: 6 }}>
      <GroupHeader
        name={group.name}
        groupKey={group.key}
        latest={latest}
        clear={older.length > 0 ? () => store.remove(group.entries.map((entry) => entry.id)) : undefined}
      />
      {shown.map((entry) => (
        <Card
          key={entry.id}
          entry={entry}
          now={now.getTime()}
          onOpen={hasDefaultAction(entry) ? () => onActivate(entry) : undefined}
          onRemove={() => store.remove([entry.id])}
        />
      ))}
      {older.length > 0 && (
        <View style={{ flexDirection: "row", justifyContent: "center" }}>
          <TextButton testID={`nc-more:${group.key}`} label={open ? "Show Less" : `${older.length} more`} onPress={onToggle} />
        </View>
      )}
    </View>
  );
}
