/**
 * The notification area (round five, frames 1, 2 and 10): down the right of
 * the screen, no panel behind it, every card paper. Live items first (the
 * holder floods, one on standby, the rest fold), then notifications by app
 * (at most three groups, then "9 more" with the apps it holds), then the
 * person's widgets, and "Edit widgets" under them. It replaces the
 * notification center's panel; the month card is the Calendar widget now.
 */

import { Button, SPACE } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useMemo, useState } from "react";
import { KeyCatcher } from "../overlay.tsx";
import { useMinuteClock } from "../shared/time/index.ts";
import {
  Btn,
  Card,
  COLUMN_WIDTH,
  EditKeys,
  EditWidgets,
  GalleryPanel,
  LiveCards,
  type Placement,
  useEditSession,
  usePlacements,
  useWidgetEnvFor,
  WidgetColumn,
  type WidgetEnv,
  WidgetEnvProvider,
  type WidgetHub,
  Words,
} from "../widgets/index.ts";
import { foldGroups } from "./lib/ceiling.ts";
import { groupByApp } from "./lib/group.ts";
import { PaperNote } from "./lib/paper-note.tsx";
import { type AreaPlace, areaBottom } from "./lib/place.ts";
import { useNotifications } from "./store.ts";
import type { HistoryEntry } from "./types.ts";

export interface NotificationAreaProps extends AreaPlace {
  hub: WidgetHub | null;
  /** What a press on a widget opens; the area closes first. */
  openerOf?: (placement: Placement) => (() => void) | null;
}

const AREA = { right: 12, top: 8, gap: SPACE.gap } as const;

export function NotificationArea({ store, onClose, onEscape = onClose, dockInset, hub, openerOf }: NotificationAreaProps) {
  const [editing, setEditing] = useState(false);
  const now = useMinuteClock().getTime();
  const placements = usePlacements(hub);
  const session = useEditSession(hub, placements, () => done());
  const done = () => {
    setEditing(false);
    session.gallery.close();
  };
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
      {editing ? <EditKeys session={session} /> : <KeyCatcher onKey={(key) => key === "Escape" && onEscape()} />}
      <WidgetEnvProvider value={env}>
        <View
          occlude
          testID="notification-center"
          style={{ position: "absolute", right: AREA.right, top: AREA.top, bottom: areaBottom(dockInset), width: COLUMN_WIDTH + 8 }}
        >
          <View testID="nc-list" style={{ flex: 1, overflow: "scroll" }}>
            <View
              style={{ flexDirection: "column", gap: AREA.gap, paddingLeft: SPACE.xs, paddingRight: SPACE.xs, paddingTop: SPACE.xs, paddingBottom: SPACE.m }}
            >
              {editing ? (
                <EditWidgets placements={placements} session={session} onDone={done} />
              ) : (
                <>
                  <LiveCards />
                  <AreaNotes store={store} env={env} now={now} onClose={onClose} />
                  <WidgetColumn placements={placements} {...(openerOf ? { openerOf } : {})} />
                  <View style={{ alignItems: "center", paddingTop: SPACE.xxs }}>
                    <Button testID="edit-widgets" label="Edit widgets" look="inks" onPress={() => setEditing(true)} />
                  </View>
                </>
              )}
            </View>
          </View>
        </View>
        {editing && session.gallery.open ? (
          <View style={{ position: "absolute", right: AREA.right + COLUMN_WIDTH + 26, top: AREA.top + 30 }}>
            <GalleryPanel placements={placements} session={session} />
          </View>
        ) : null}
      </WidgetEnvProvider>
    </>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap, flex: 1, paddingLeft: SPACE.button, paddingRight: SPACE.m }}>
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
