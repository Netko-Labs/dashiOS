/**
 * Recently changed: every change to a setting, newest first, with who made
 * it (you, or an agent by name, in shiso) and Undo while the setting still
 * holds what that change set (lib/changes/log.ts `canUndo`). ❖Z undoes the
 * newest. Pressing a change opens its pane at its row. A pane in the
 * sidebar (You), and at dashi://settings/recent.
 */

import { useState, useSyncExternalStore } from "react";
import { type FlagsStore, useFlags } from "../../../shared/control-center/index.ts";
import { isPaneId } from "../../../shared/settings/index.ts";
import type { PaneContext } from "../../context.ts";
import { useSettings } from "../../hooks.ts";
import { findRow, rowPlace } from "../../registry/index.ts";
import { Spot } from "../../spot.tsx";
import type { SettingsStore } from "../../store.ts";
import { Caption, Group, Note, Page } from "../../ui.tsx";
import type { ChangeEntry, ChangeLog } from "../changes/log.ts";
import { changeLine } from "../changes/words.ts";
import { ChangeRow } from "./change-row.tsx";

/** Where an entry's setting is, to open Settings at; none for a row that is gone. */
export function placeOf(entry: Pick<ChangeEntry, "words">): { pane: string; row: string } | null {
  const row = entry.words.row ? findRow(entry.words.row) : undefined;
  return row ? rowPlace(row) : null;
}

/** Undo for one entry, and the line that says how it went. */
export function useUndoEntry(changes: Pick<ChangeLog, "undoEntry">): { notice: string | null; undo: (entry: ChangeEntry) => void } {
  const [notice, setNotice] = useState<string | null>(null);
  const undo = (entry: ChangeEntry) => {
    void changes
      .undoEntry(entry.id)
      .then((done) => setNotice(done ? `Undone: ${changeLine(entry.words)}.` : "That can't be undone now: the setting changed again since."))
      .catch(() => setNotice("That couldn't be undone. Try again."));
  };
  return { notice, undo };
}

export function RecentPane({ changes, settings, flags, show }: { changes: ChangeLog; settings: SettingsStore; flags: FlagsStore; show: PaneContext["show"] }) {
  const entries = useSyncExternalStore(changes.subscribe, changes.getSnapshot);
  // Whether each can be undone follows the values themselves.
  useSettings(settings);
  useFlags(flags);
  const { notice, undo } = useUndoEntry(changes);
  const open = (entry: ChangeEntry) => {
    const place = placeOf(entry);
    const pane = place?.pane;
    if (!place || !isPaneId(pane)) return undefined;
    return () => show(pane, place.row);
  };
  return (
    <Page title="Recently changed">
      <Spot id="recent/changes" cards>
        <Group testID="recent-changes">
          {entries.length === 0 ? (
            <Note testID="recent-none">Nothing has changed yet. When you or an agent changes a setting, it's listed here, with Undo.</Note>
          ) : (
            entries.map((entry) => (
              <ChangeRow
                key={entry.id}
                testID={`recent:${entry.id}`}
                entry={entry}
                canUndo={changes.canUndo(entry)}
                onUndo={() => undo(entry)}
                onOpen={open(entry)}
              />
            ))
          )}
        </Group>
      </Spot>
      {notice !== null ? <Caption>{notice}</Caption> : <Caption keys="❖Z">The newest change is undone with</Caption>}
    </Page>
  );
}
