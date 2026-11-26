/**
 * One icon in the Dock and the thin divider between its groups: the picture,
 * the attention badge (critical, the one coloured mark: DK-1), an app's count
 * and its download (ink, never red or the accent: DK-3, badges.ts), the dot
 * under a running app, and the pointer, hover and right-click it reports
 * (view.tsx decides what those do). Magnified (DK-6) it is drawn bigger and
 * lifted; its box grows with it, so the row widens and a press lands on the
 * icon drawn under the pointer.
 */

import { CLEAR, GLASS, pill, RADIUS, SPACE, TYPE, useColors, useSolidTwin, WEIGHT } from "@dashi/ui";
import { type Bounds, type DropInfo, type PointerInfo, Text, View } from "@mirinjs/metal";
import { useRef } from "react";
import { AppIcon } from "../../shared/apps/index.ts";
import { DOCK } from "../../theme.ts";
import type { Badge } from "../badges.ts";
import { AT_REST, type Magnified, magnifiedSize } from "./magnify.ts";

const SETTLED = { offset: 0, opacity: 1 } as const;

export function Divider() {
  const colors = useColors();
  return (
    <View
      style={{
        width: 1,
        height: DOCK.icon - 4,
        marginTop: SPACE.xxs,
        marginLeft: SPACE.xxs,
        marginRight: SPACE.xxs,
        backgroundColor: colors.separator,
      }}
    />
  );
}

/** A Dock icon is a button named by its app (a minimized window's title after it), for screen readers and agents. */
const asButton = (label: string, onPress: () => void) => ({ accessibilityRole: "button" as const, accessibilityLabel: label, onPress });

export interface DockIconProps {
  label: string;
  icon: string;
  running: boolean;
  /** A window of this app wants attention. */
  attention?: boolean;
  opacity?: number;
  onPress: () => void;
  /** The pointer's phases on the icon, with the icon's center. */
  onPointer?: (event: PointerInfo, centerX: number) => void;
  /** A right-click, with the icon's center. */
  onMenu?: (centerX: number) => void;
  /** Where the icon was laid out (on the Dock's surface). */
  onTile?: (bounds: Bounds) => void;
  /** Its part of the Dock's entrance (slide.tsx `iconRise`): below its place, and how opaque. */
  rise?: { offset: number; opacity: number };
  /** Its magnification (magnify.ts): drawn bigger and lifted. */
  magnified?: Magnified;
  /** What its app says on it: a count, a download's progress. */
  badge?: Badge | undefined;
  /** The pointer came onto it (with its bounds) or left it. */
  onHover?: (hovered: boolean, bounds?: Bounds) => void;
  /** Files dropped on it (the Trash). */
  onDrop?: (paths: readonly string[]) => void;
  testID: string;
}

export function DockIcon({
  label,
  icon,
  running,
  attention = false,
  opacity = 1,
  onPress,
  onPointer,
  onMenu,
  onTile,
  rise = SETTLED,
  magnified = AT_REST,
  badge,
  onHover,
  onDrop,
  testID,
}: DockIconProps) {
  const colors = useColors();
  const size = magnifiedSize(DOCK.icon, magnified);
  // Events carry the icon's bounds when they can; the last layout stands in for the rest.
  const laid = useRef<Bounds | null>(null);
  const centerOf = (bounds?: Bounds) => {
    const box = bounds ?? laid.current;
    return box ? box.x + box.width / 2 : 0;
  };
  return (
    <View
      style={{ flexDirection: "column", alignItems: "center", gap: SPACE.xxs }}
      onLayout={(bounds) => {
        laid.current = bounds;
        onTile?.(bounds);
      }}
      {...asButton(label, onPress)}
      onPointer={onPointer && ((event) => onPointer(event, centerOf(event.bounds)))}
      onContextMenu={onMenu && (() => onMenu(centerOf()))}
      {...(onHover ? { onHoverChange: onHover } : {})}
      {...(onDrop ? { onDrop: (event: DropInfo) => event.phase === "drop" && onDrop(event.paths) } : {})}
      testID={testID}
    >
      {/* The entrance moves the picture, not the icon's box: the minimize animation aims at the box. */}
      <View style={{ width: size, height: size, marginTop: DOCK.icon - size, position: "relative", top: rise.offset - magnified.lift, opacity: rise.opacity }}>
        <AppIcon source={icon} style={{ width: size, height: size, opacity }} />
        {badge?.progress !== undefined ? <DownloadBar progress={badge.progress} testID={`${testID}-download`} /> : null}
        {badge?.count ? <CountMark count={badge.count} testID={`${testID}-count`} /> : null}
        {attention && <AttentionMark testID={`${testID}-attention`} />}
      </View>
      <View
        style={{
          width: DOCK.dot,
          height: DOCK.dot,
          borderRadius: DOCK.dot / 2,
          backgroundColor: running ? colors.dot : CLEAR,
        }}
      />
    </View>
  );
}

/** A count (DK-3): an ink pill with onPrimary words, past the icon's top right corner; "99+" past 99. */
function CountMark({ count, testID }: { count: number; testID: string }) {
  const colors = useColors();
  const ring = useSolidTwin("thin");
  const { height, padding, offset, ring: ringWidth } = GLASS.dock.badge;
  return (
    <View
      testID={testID}
      style={{
        position: "absolute",
        top: -offset,
        right: -offset,
        minWidth: height + 2 * ringWidth,
        height: height + 2 * ringWidth,
        paddingHorizontal: padding,
        borderRadius: pill(height + 2 * ringWidth),
        borderWidth: ringWidth,
        borderColor: ring,
        backgroundColor: colors.primary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: TYPE.caption.size, lineHeight: height, fontWeight: WEIGHT.bold, color: colors.onPrimary }}>{countWords(count)}</Text>
    </View>
  );
}

/** A count as the badge says it: the number, "99+" past 99. */
export const countWords = (count: number): string => (count > 99 ? "99+" : String(Math.floor(count)));

/** A download's progress (DK-3): an ink bar on a paper plate across the icon's foot, never the accent. */
function DownloadBar({ progress, testID }: { progress: number; testID: string }) {
  const colors = useColors();
  const plate = useSolidTwin("paper");
  const { height, inset, bottom, border } = GLASS.dock.download;
  const inner = height - 2 * border;
  return (
    <View
      testID={testID}
      accessibilityRole="status"
      accessibilityLabel={`Downloading, ${Math.round(progress * 100)}%`}
      style={{
        position: "absolute",
        left: inset,
        right: inset,
        bottom,
        height,
        padding: border,
        borderRadius: pill(height),
        backgroundColor: plate,
        borderWidth: GLASS.hairline.width,
        borderColor: colors.separator,
      }}
    >
      <View style={{ width: `${Math.round(progress * 100)}%`, height: inner, borderRadius: pill(inner), backgroundColor: colors.primary }} />
    </View>
  );
}

/** A window that asks for attention (DK-1): the critical badge, the one coloured mark on the Dock, ringed in the Dock's twin. */
function AttentionMark({ testID }: { testID: string }) {
  const colors = useColors();
  const ring = useSolidTwin("thin");
  return (
    <View
      testID={testID}
      style={{
        position: "absolute",
        top: -3,
        right: -3,
        width: 14,
        height: 14,
        borderRadius: RADIUS.control,
        borderWidth: 2,
        borderColor: ring,
        backgroundColor: colors.critical,
      }}
    />
  );
}
