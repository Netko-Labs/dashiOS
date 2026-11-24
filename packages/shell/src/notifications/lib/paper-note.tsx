/**
 * A notification in the area, printed as paper (round five, frame 1): the
 * app's icon, its name in small capitals, the time (or "+2" when its group
 * holds more), the title, the body, and its actions as the kit's Buttons in
 * the inks look. The measures are the one card's (NO-1, card.tsx); its
 * paper and corner are a widget's (CO-11).
 * A group of several shows two hairline edges under it; a press on "+n"
 * opens the rest.
 */

import { Button, RADIUS, SPACE } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useMemo } from "react";
import { AppIcon } from "../../shared/apps/index.ts";
import { Card, cardColours, Lab, Meta, Title, type WidgetEnv, Words } from "../../widgets/index.ts";
import { ellipsize } from "../text.ts";
import type { HistoryEntry } from "../types.ts";
import { NOTE_CARD } from "./card.tsx";
import { relativeTime } from "./group.ts";
import { notificationIcon } from "./icon.ts";

/** The note's width in the area's column. */
const PAPER_NOTE = { width: 356 } as const;

export function PaperNote({
  entry,
  env,
  more,
  now,
  onOpen,
  onAction,
  onMore,
}: {
  entry: HistoryEntry;
  env: WidgetEnv;
  /** How many more its group holds (0: none). */
  more: number;
  now: number;
  onOpen?: () => void;
  onAction: (key: string) => void;
  onMore?: () => void;
}) {
  const icon = useMemo(
    () => notificationIcon({ imagePath: "", appIcon: entry.appIcon, desktopEntry: entry.desktopEntry }),
    [entry.appIcon, entry.desktopEntry],
  );
  const look = { inks: env.inks, ink: null, air: false, houseDown: env.tally.houseDown, redact: false };
  const paper = cardColours(look);
  const actions = entry.closed ? [] : entry.actions.filter((action) => action.key !== "default").slice(0, 3);
  return (
    <View style={{ marginBottom: more > 0 ? SPACE.s : 0 }}>
      {more > 0 ? (
        <View
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            bottom: -5,
            height: 12,
            borderRadius: RADIUS.card,
            borderWidth: 1,
            borderColor: paper.hairline,
            backgroundColor: paper.paper,
          }}
        />
      ) : null}
      <Card look={look} width={PAPER_NOTE.width} padding={NOTE_CARD.padding} testID={`nc-card:${entry.id}`} {...(onOpen ? { onPress: onOpen } : {})}>
        <View style={{ flexDirection: "row", gap: NOTE_CARD.gap }}>
          <AppIcon source={icon} resizeMode="contain" style={{ width: NOTE_CARD.icon, height: NOTE_CARD.icon, borderRadius: NOTE_CARD.iconRadius }} />
          <View style={{ flex: 1, flexDirection: "column" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACE.xxs }}>
              <Lab>{entry.appName || "Notification"}</Lab>
              <View style={{ flexDirection: "row", gap: SPACE.s, alignItems: "center" }}>
                {more > 0 ? (
                  <View testID={`nc-more:${entry.id}`} {...(onMore ? { onPress: onMore } : {})}>
                    <Meta>{`+${more}`}</Meta>
                  </View>
                ) : null}
                <Meta>{relativeTime(entry.time, now)}</Meta>
              </View>
            </View>
            <Title>{ellipsize(entry.summary || entry.appName, 40)}</Title>
            {entry.body !== "" ? <Words lines={3}>{ellipsize(entry.body, 140)}</Words> : null}
            {actions.length > 0 ? (
              <View style={{ flexDirection: "row", gap: SPACE.s, marginTop: NOTE_CARD.actionsGap }}>
                {actions.map((action, i) => (
                  <Button
                    key={action.key}
                    label={action.label || action.key}
                    look="inks"
                    primary={i === actions.length - 1 && actions.length > 1}
                    onPress={() => onAction(action.key)}
                    testID={`nc-action:${entry.id}:${action.key}`}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </Card>
    </View>
  );
}
