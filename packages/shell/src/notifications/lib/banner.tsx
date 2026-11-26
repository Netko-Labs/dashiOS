/**
 * One notification banner: icon, summary, a short body, and a button for each
 * action beyond `default` (a click anywhere else runs `default`, or just
 * dismisses). Regular glass, 356 wide, radius 18, shadow xl (NO-5, NO-6,
 * D766): its words and small Buttons read the glass (the vibrant inks, the
 * glass control edge). Each banner is its own overlay surface, because a
 * Metal host can't resize or move its layer surface yet; `bannerHeight` says
 * how tall to make it so the stack (stack.ts) can place them in their lane.
 */

import { Button, CLOSE, Frosted, GLASS, GlyphButton, OffGlass, SHADOW, SPACE } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useState } from "react";
import { type NotificationStore, useNotifications } from "../store.ts";
import { ellipsize } from "../text.ts";
import type { Notification, NotificationAction } from "../types.ts";
import { NOTE_CARD, NoteCard, NoteTime } from "./card.tsx";
import { notificationIcon } from "./icon.ts";

export const BANNER = {
  /** The panel's width (NO-6). */
  width: GLASS.banner.width,
  radius: GLASS.banner.radius,
  /** Between two banners in the lane. */
  gap: GLASS.banner.gap,
  /** Transparent room round the panel for its shadow: at its sides and top, and below it, where xl falls. */
  shadow: SPACE.page,
  shadowTop: SPACE.inset,
  shadowBelow: SPACE.xl,
  bodyLines: 2,
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
 * The panel's height: the card's padding around its icon or its words,
 * whichever is taller. The body always reserves its full two lines: its
 * wrapping isn't known before painting, and a banner that changed height
 * as it was read would have to be rebuilt.
 */
export function bannerHeight(notification: Pick<Notification, "body" | "actions">): number {
  const body = notification.body ? NOTE_CARD.textGap + BANNER.bodyLines * NOTE_CARD.bodyLine : 0;
  const buttons = buttonsFor(notification).length > 0 ? NOTE_CARD.actionsGap + NOTE_CARD.actionRow : 0;
  return NOTE_CARD.padding * 2 + Math.max(NOTE_CARD.icon, NOTE_CARD.summaryLine + body + buttons);
}

/** The surface's size: the panel with its shadow room. */
export function bannerSurface(notification: Pick<Notification, "body" | "actions">): { width: number; height: number } {
  return { width: BANNER.width + BANNER.shadow * 2, height: BANNER.shadowTop + bannerHeight(notification) + BANNER.shadowBelow };
}

/** The banner for notification `id`, following the store while it lives. */
export function Banner({ store, id }: { store: NotificationStore; id: number }) {
  const [hovered, setHovered] = useState(false);
  const notification = useNotifications(store).live.find((candidate) => candidate.id === id);
  if (!notification) return null;
  const buttons = buttonsFor(notification);
  const press = () => {
    if (!store.invoke(id, "default")) store.dismiss(id);
  };

  return (
    <View style={{ flex: 1, alignItems: "center", paddingTop: BANNER.shadowTop }}>
      <Frosted
        level="regular"
        occlude
        testID="banner"
        style={{ width: BANNER.width, height: bannerHeight(notification), borderRadius: BANNER.radius, shadow: SHADOW.xl }}
        onPress={press}
        onHoverChange={(over) => {
          setHovered(over);
          store.hold(id, over);
        }}
      >
        <NoteCard
          testID="banner-card"
          icon={notificationIcon(notification)}
          title={ellipsize(notification.summary || notification.appName, BANNER.summaryChars)}
          body={ellipsize(notification.body, BANNER.bodyChars)}
          bodyLines={BANNER.bodyLines}
          critical={notification.urgency === "critical"}
          aside={<NoteTime words="now" />}
          {...(buttons.length > 0
            ? {
                actions: buttons.map((action) => (
                  <Button
                    key={action.key}
                    testID={`banner-action:${action.key}`}
                    label={action.label || action.key}
                    size="small"
                    onPress={() => store.invoke(id, action.key)}
                  />
                )),
              }
            : {})}
        />
        {hovered ? <Dismiss onPress={() => store.dismiss(id)} /> : null}
      </Frosted>
    </View>
  );
}

/** Where the hover ✕ sits: over the panel's top-left corner (frost-objects board 18). */
const DISMISS = { at: -SPACE.s } as const;

/** The ✕ under the pointer: a solid disc, never glass (GL-6, as a tooltip), that dismisses the banner. */
function Dismiss({ onPress }: { onPress: () => void }) {
  return (
    <View style={{ position: "absolute", left: DISMISS.at, top: DISMISS.at }}>
      <OffGlass>
        <GlyphButton testID="banner-dismiss" glyph={CLOSE} label="Dismiss" size="small" filled onPress={onPress} />
      </OffGlass>
    </View>
  );
}
