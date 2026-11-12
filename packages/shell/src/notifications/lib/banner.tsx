/**
 * One notification banner: icon, summary, a short body, and a button for each
 * action beyond `default` (a click anywhere else runs `default`, or just
 * dismisses). Each banner is its own overlay surface, because a Metal host
 * can't resize or move its layer surface yet; `bannerHeight` says how tall to
 * make it so the stack (stack.ts) can place them.
 */

import { useColors } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { type NotificationStore, useNotifications } from "../store.ts";
import { ellipsize } from "../text.ts";
import type { Notification, NotificationAction } from "../types.ts";
import { notificationIcon } from "./icon.ts";

export const BANNER = {
  /** The panel's width. */
  width: 344,
  /** Transparent room around the panel for its shadow, on every side of the surface. */
  shadow: 12,
  radius: 14,
  padding: 12,
  icon: 36,
  gap: 10,
  summaryLine: 18,
  bodyLines: 2,
  bodyLine: 16,
  actionRow: 26,
  /** What two lines of the body hold; a longer one is cut with an ellipsis. */
  bodyChars: 88,
  /** What the title's one line holds beside "now", in bold; a longer one is cut with an ellipsis (the host's own cut can clip instead). */
  summaryChars: 34,
} as const;

/** The buttons: every action but `default`, which is the click. */
export function buttonsFor(notification: Pick<Notification, "actions">): NotificationAction[] {
  return notification.actions.filter((action) => action.key !== "default").slice(0, 3);
}

/**
 * The panel's height. The body always reserves its full two lines: its
 * wrapping isn't known before painting, and a banner that changed height
 * as it was read would have to be rebuilt.
 */
export function bannerHeight(notification: Pick<Notification, "body" | "actions">): number {
  const text = BANNER.summaryLine + (notification.body ? 4 + BANNER.bodyLines * BANNER.bodyLine : 0);
  const buttons = buttonsFor(notification).length > 0 ? 8 + BANNER.actionRow : 0;
  return BANNER.padding * 2 + Math.max(BANNER.icon, text) + buttons;
}

/** The surface's size: the panel with its shadow room. */
export function bannerSurface(notification: Pick<Notification, "body" | "actions">): { width: number; height: number } {
  return { width: BANNER.width + BANNER.shadow * 2, height: bannerHeight(notification) + BANNER.shadow * 2 };
}

function ActionButton({ label, testID, onPress }: { label: string; testID: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      style={{
        height: BANNER.actionRow,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 7,
        justifyContent: "center",
        backgroundColor: colors.button,
        hoverBackgroundColor: colors.separator,
      }}
      onPress={onPress}
    >
      <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>{label}</Text>
    </View>
  );
}

/** The banner for notification `id`, following the store while it lives. */
export function Banner({ store, id }: { store: NotificationStore; id: number }) {
  const colors = useColors();
  const notification = useNotifications(store).live.find((candidate) => candidate.id === id);
  if (!notification) return null;
  const buttons = buttonsFor(notification);
  const press = () => {
    if (!store.invoke(id, "default")) store.dismiss(id);
  };

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        testID="banner"
        style={{
          width: BANNER.width,
          height: bannerHeight(notification),
          flexDirection: "column",
          gap: 8,
          padding: BANNER.padding,
          borderRadius: BANNER.radius,
          backgroundColor: colors.launcher,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "lg",
        }}
        onPress={press}
        onHoverChange={(hovered) => store.hold(id, hovered)}
      >
        <View style={{ flexDirection: "row", gap: BANNER.gap, flex: 1 }}>
          <Image source={notificationIcon(notification)} resizeMode="contain" style={{ width: BANNER.icon, height: BANNER.icon, borderRadius: 8 }} />
          <View style={{ flex: 1, flexDirection: "column", gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: BANNER.summaryLine }}>
              {notification.urgency === "critical" && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.critical }} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>
                  {ellipsize(notification.summary || notification.appName, BANNER.summaryChars)}
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>now</Text>
            </View>
            {notification.body !== "" && (
              <View style={{ height: BANNER.bodyLines * BANNER.bodyLine, overflow: "hidden" }}>
                <Text style={{ fontSize: 12, lineHeight: BANNER.bodyLine, color: colors.textMuted }}>{ellipsize(notification.body, BANNER.bodyChars)}</Text>
              </View>
            )}
          </View>
        </View>
        {buttons.length > 0 && (
          <View style={{ flexDirection: "row", gap: 6, paddingLeft: BANNER.icon + BANNER.gap }}>
            {buttons.map((action) => (
              <ActionButton
                key={action.key}
                testID={`banner-action:${action.key}`}
                label={action.label || action.key}
                onPress={() => store.invoke(id, action.key)}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
