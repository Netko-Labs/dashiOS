/**
 * The pieces of the notification center's list: a notification's card, a
 * group's header, and the small text buttons. A card's close button sits
 * beside the clickable part, not on it, so a press can only mean one thing.
 */

import { Image, Svg, Text, View } from "@mirinjs/metal";
import { useMemo, useState } from "react";
import { useColors } from "../theme.ts";
import { relativeTime } from "./group.ts";
import { notificationIcon } from "./icon.ts";
import { ellipsize } from "./text.ts";
import type { HistoryEntry } from "./types.ts";

const CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5" stroke="#000" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;

export const CARD = {
  radius: 12,
  padding: 10,
  /** The column on the right: the time at rest, the close button on hover. */
  side: 54,
  summaryLine: 18,
  bodyLine: 16,
  /** What a few lines of the body hold; a longer one is cut with an ellipsis. */
  bodyChars: 120,
  icon: 18,
} as const;

/** Whether a click on it can do something: it still has a `default` action. */
export function hasDefaultAction(entry: Pick<HistoryEntry, "actions">): boolean {
  return entry.actions.some((action) => action.key === "default");
}

export function TextButton({ label, testID, onPress }: { label: string; testID: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        height: 22,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 6,
        justifyContent: "center",
        hoverBackgroundColor: colors.separator,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

/** One notification: summary and time, a short body, ✕ on hover. */
export function Card({
  entry,
  now,
  onOpen,
  onRemove,
}: {
  entry: HistoryEntry;
  now: number;
  /** Runs the click; omitted when there is nothing to run. */
  onOpen?: () => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const [hovered, setHovered] = useState(false);
  const { summary, appName, body, urgency, time, id } = entry;
  return (
    <View
      testID={`nc-card:${id}`}
      onHoverChange={setHovered}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        borderRadius: CARD.radius,
        backgroundColor: colors.tile,
        hoverBackgroundColor: colors.tileHover,
      }}
    >
      <View
        testID={`nc-open:${id}`}
        onPress={onOpen}
        style={{ flex: 1, flexDirection: "column", gap: 2, padding: CARD.padding, paddingRight: 0, minWidth: 0 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: CARD.summaryLine }}>
          {urgency === "critical" && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.critical }} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>
              {summary || appName}
            </Text>
          </View>
        </View>
        {body !== "" && (
          <Text style={{ fontSize: 12, lineHeight: CARD.bodyLine, color: colors.textMuted }}>{ellipsize(body, CARD.bodyChars)}</Text>
        )}
      </View>
      <View
        style={{
          width: CARD.side,
          height: CARD.summaryLine + CARD.padding,
          paddingTop: CARD.padding - 1,
          paddingRight: CARD.padding,
          alignItems: "flex-end",
        }}
      >
        {hovered ? (
          <View
            testID={`nc-remove:${id}`}
            onPress={onRemove}
            style={{
              width: CARD.icon,
              height: CARD.icon,
              borderRadius: CARD.icon / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.track,
              hoverBackgroundColor: colors.checkbox,
            }}
          >
            <Svg markup={CLOSE} size={9} color={colors.text} />
          </View>
        ) : (
          <View onPress={onOpen} style={{ height: CARD.icon, justifyContent: "center" }}>
            <Text style={{ fontSize: 11, color: colors.textMuted }}>{relativeTime(time, now)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** An app's name over its notifications, with its icon. */
export function GroupHeader({
  name,
  groupKey,
  latest,
  clear,
}: {
  name: string;
  groupKey: string;
  latest: Pick<HistoryEntry, "appIcon" | "desktopEntry">;
  /** Present for a group of several. */
  clear?: () => void;
}) {
  const colors = useColors();
  // Looking an icon up walks the icon directories: once per app, not once per render.
  const { appIcon, desktopEntry } = latest;
  const icon = useMemo(() => notificationIcon({ imagePath: "", appIcon, desktopEntry }), [appIcon, desktopEntry]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 22, paddingLeft: 4 }}>
      <Image source={icon} resizeMode="contain" style={{ width: CARD.icon, height: CARD.icon, borderRadius: 4 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "semibold", color: colors.textMuted }}>
          {name}
        </Text>
      </View>
      {clear && <TextButton testID={`nc-clear-group:${groupKey}`} label="Clear All" onPress={clear} />}
    </View>
  );
}
