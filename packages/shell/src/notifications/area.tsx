/**
 * The notification area (round five, frames 1, 2 and 10): down the right of
 * the screen, no panel behind it, every card paper. Live items first (the
 * holder floods, one on standby, the rest fold), then notifications by app
 * (at most three groups, then "9 more" with the apps it holds), then the
 * person's widgets, and "Edit widgets" under them. It replaces the
 * notification center's panel; the month card is the Calendar widget now.
 */

import { Text, View } from "@mirinjs/metal";
import { useMemo, useState } from "react";
import { KeyCatcher } from "../overlay.tsx";
import { useMinuteClock } from "../shared/time/index.ts";
import {
  Btn,
  Card,
  COLUMN_WIDTH,
  EditWidgets,
  GalleryPanel,
  LiveCards,
  type Placement,
  usePlacements,
  useWidgetEnvFor,
  WidgetColumn,
  type WidgetEnv,
  WidgetEnvProvider,
  type WidgetHub,
  Words,
} from "../widgets/index.ts";
import { centerBottom, type NotificationCenterProps } from "./center.tsx";
import { foldGroups } from "./lib/ceiling.ts";
import { groupByApp } from "./lib/group.ts";
import { PaperNote } from "./lib/paper-note.tsx";
import { useNotifications } from "./store.ts";
import type { HistoryEntry } from "./types.ts";

export interface NotificationAreaProps extends NotificationCenterProps {
  hub: WidgetHub | null;
  /** What a press on a widget opens; the area closes first. */
  openerOf?: (placement: Placement) => (() => void) | null;
}

const AREA = { right: 12, top: 8, gap: 10 } as const;

export function NotificationArea({ store, onClose, onEscape = onClose, dockInset, hub, openerOf }: NotificationAreaProps) {
  const [editing, setEditing] = useState(false);
  const [gallery, setGallery] = useState(false);
  const now = useMinuteClock().getTime();
  const placements = usePlacements(hub);
  const env = useWidgetEnvFor(hub, {
    locked: false,
    placements,
    open: ({ run }) => {
      onClose();
      run();
    },
  });
  return (
    <>
      {editing ? null : <KeyCatcher onKey={(key) => key === "Escape" && onEscape()} />}
      <WidgetEnvProvider value={env}>
        <View
          occlude
          testID="notification-center"
          style={{ position: "absolute", right: AREA.right, top: AREA.top, bottom: centerBottom(dockInset), width: COLUMN_WIDTH + 8 }}
        >
          <View testID="nc-list" style={{ flex: 1, overflow: "scroll" }}>
            <View style={{ flexDirection: "column", gap: AREA.gap, paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 8 }}>
              {editing ? (
                <EditWidgets
                  placements={placements}
                  onDone={() => {
                    setEditing(false);
                    setGallery(false);
                  }}
                  onGallery={() => setGallery(!gallery)}
                />
              ) : (
                <>
                  <LiveCards />
                  <AreaNotes store={store} env={env} now={now} onClose={onClose} />
                  <WidgetColumn placements={placements} {...(openerOf ? { openerOf } : {})} />
                  <View style={{ alignItems: "center", paddingTop: 2 }}>
                    <EditButton inks={env.inks} onPress={() => setEditing(true)} />
                  </View>
                </>
              )}
            </View>
          </View>
        </View>
        {editing && gallery ? (
          <View style={{ position: "absolute", right: AREA.right + COLUMN_WIDTH + 26, top: AREA.top + 30 }}>
            <GalleryPanel placements={placements} onClose={() => setGallery(false)} />
          </View>
        ) : null}
      </WidgetEnvProvider>
    </>
  );
}

function EditButton({ inks, onPress }: { inks: WidgetEnv["inks"]; onPress: () => void }) {
  return (
    <View
      testID="edit-widgets"
      onPress={onPress}
      style={{
        height: 28,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 14,
        justifyContent: "center",
        backgroundColor: inks.paper,
        borderWidth: 1,
        borderColor: inks.text.hairline,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "semibold", color: inks.text.ink }}>Edit widgets</Text>
    </View>
  );
}

/** The notifications, by app: at most three groups, then "n more" with the apps it holds. */
function AreaNotes({ store, env, now, onClose }: { store: NotificationAreaProps["store"]; env: WidgetEnv; now: number; onClose: () => void }) {
  const { history } = useNotifications(store);
  const groups = useMemo(() => groupByApp(history), [history]);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const folded = foldGroups(groups, all);
  const activate = (entry: HistoryEntry) => {
    onClose();
    void store.activate(entry.id).then((ran) => {
      if (!ran) store.remove([entry.id]);
    });
  };
  return (
    <>
      {folded.shown.map((group) => {
        const expanded = open.has(group.key);
        const [latest, ...older] = group.entries as [HistoryEntry, ...HistoryEntry[]];
        return (expanded ? group.entries : [latest]).map((entry) => (
          <PaperNote
            key={entry.id}
            entry={entry}
            env={env}
            now={now}
            more={expanded ? 0 : older.length}
            {...(entry.actions.some((action) => action.key === "default") ? { onOpen: () => activate(entry) } : {})}
            onAction={(key) => store.invoke(entry.id, key)}
            onMore={() => setOpen(new Set([...open, group.key]))}
          />
        ));
      })}
      {folded.more ? (
        <Card
          look={{ inks: env.inks, ink: null, air: false, houseDown: env.tally.houseDown, redact: false }}
          width={COLUMN_WIDTH}
          height={38}
          compact
          padding={0}
          testID="nc-show-all"
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, paddingLeft: 14, paddingRight: 8 }}>
            <Words ink>{`${folded.more.count} more`}</Words>
            <Words max={26}>{folded.more.apps.join(", ")}</Words>
            <View style={{ flex: 1 }} />
            <Btn label="Show all" onPress={() => setAll(true)} testID="nc-all" />
          </View>
        </Card>
      ) : null}
    </>
  );
}
