/**
 * A notification in the area, printed as paper (round five, frame 1): the
 * app's icon in a ring, its name in small capitals, the time (or "+2" when
 * its group holds more), the title, the body, and its actions as buttons.
 * A group of several shows two hairline edges under it; a press on "+n"
 * opens the rest.
 */

import { View } from "@mirinjs/metal";
import { useMemo } from "react";
import { AppIcon } from "../../shared/apps/index.ts";
import { Btn, Card, cardColours, Lab, Meta, Title, useCard, type WidgetEnv, Words } from "../../widgets/index.ts";
import { ellipsize } from "../text.ts";
import type { HistoryEntry } from "../types.ts";
import { relativeTime } from "./group.ts";
import { notificationIcon } from "./icon.ts";

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
    <View style={{ marginBottom: more > 0 ? 6 : 0 }}>
      {more > 0 ? (
        <View
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            bottom: -5,
            height: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: paper.hairline,
            backgroundColor: paper.paper,
          }}
        />
      ) : null}
      <Card look={look} width={356} padding={13} testID={`nc-card:${entry.id}`} {...(onOpen ? { onPress: onOpen } : {})}>
        <View style={{ flexDirection: "row", gap: 11 }}>
          <NoteIcon source={icon} />
          <View style={{ flex: 1, flexDirection: "column" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
              <Lab>{entry.appName || "Notification"}</Lab>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
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
              <View style={{ flexDirection: "row", gap: 6, marginTop: 9 }}>
                {actions.map((action, i) => (
                  <Btn
                    key={action.key}
                    label={action.label}
                    fill={i === actions.length - 1 && actions.length > 1}
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

function NoteIcon({ source }: { source: string }) {
  const c = useCard();
  return (
    <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: c.hairline, alignItems: "center", justifyContent: "center" }}>
      <AppIcon source={source} resizeMode="contain" style={{ width: 16, height: 16, borderRadius: 4 }} />
    </View>
  );
}
