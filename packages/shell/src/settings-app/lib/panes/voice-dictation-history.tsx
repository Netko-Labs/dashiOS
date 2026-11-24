/**
 * Settings › Voice › Dictation's history (voice.tsx; dictation/history.ts):
 * what was dictated in the last day, the newest first, the words that were
 * typed over when, and what was heard when that differs, each with Copy and
 * Delete (at once, with Undo); Delete all confirms in place (SE-12); how long
 * it is kept, and "Nothing". Only the person's own press changes how long,
 * or deletes.
 */

import { FoldedChoices, MoreButton, SPACE, TYPE, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { HistoryEntry } from "../../../dictation/index.ts";
import { Caption, Group, Note, TUCK } from "../../../shared/cards/index.ts";
import { HISTORY_KEEPS, type HistoryKeep, isHistoryKeep } from "../../../shared/pill/index.ts";
import { useColors } from "../../colors.ts";
import type { PaneContext } from "../../context.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { ONLY_YOU, type PersonOnly } from "../person-only.ts";
import { PAGE } from "../row.tsx";
import { Setting } from "../setting.tsx";
import { ConfirmDelete, MiniButton } from "./parts.tsx";

type Source = NonNullable<PaneContext["dictation"]>;

const KEEP_LABELS: Readonly<Record<HistoryKeep, string>> = { day: "A day", week: "A week", none: "Nothing" };
const KEEP_OPTIONS = HISTORY_KEEPS.map((value) => ({ value, label: KEEP_LABELS[value] }));

/** How many show before "Show all". */
const FIRST = 8;

/** "14:05 · Text Editor · Writing", and what became of it. */
export function whenWords(entry: HistoryEntry, now = Date.now()): string {
  const at = new Date(entry.at);
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = now - entry.at > 86_400_000 ? `${at.toLocaleDateString(undefined, { weekday: "short" })} ` : "";
  const after = entry.after === "undone" ? "taken back" : entry.after === "raw" ? "changed to as heard" : "";
  return [`${day}${time}`, entry.app, entry.profile, after].filter(Boolean).join(" · ");
}

/** An entry: what was typed as its name (it wraps: a history is read whole), then when and where, then what was heard when that differs. */
function Entry({ entry, source, onDelete }: { entry: HistoryEntry; source: Source; onDelete: () => void }) {
  const colors = useColors();
  const same = entry.heard === entry.typed;
  const quiet = { fontSize: TYPE.panel.detail.size, color: colors.textMuted } as const;
  return (
    <View
      testID={`dictation-history:${entry.id}`}
      style={{ flexDirection: "row", alignItems: "center", gap: PAGE.gap, minHeight: PAGE.row, paddingHorizontal: PAGE.inset, paddingVertical: PAGE.pad }}
    >
      <View style={{ flex: 1, flexDirection: "column", gap: SPACE.px, minWidth: 0 }}>
        <View testID={`dictation-history-typed:${entry.id}`}>
          <Text style={{ fontSize: TYPE.panel.name.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{entry.typed}</Text>
        </View>
        <Text numberOfLines={1} style={quiet}>
          {whenWords(entry)}
        </Text>
        {!same && (
          <View testID={`dictation-history-heard:${entry.id}`}>
            <Text style={quiet}>{`Heard: ${entry.heard}`}</Text>
          </View>
        )}
      </View>
      <MiniButton testID={`dictation-history-copy:${entry.id}`} label="Copy" onPress={() => source.copy(entry.typed)} />
      {!same && <MiniButton testID={`dictation-history-copy-heard:${entry.id}`} label="Copy as heard" onPress={() => source.copy(entry.heard)} />}
      <MiniButton testID={`dictation-history-delete:${entry.id}`} label="Delete" tone="critical" onPress={onDelete} />
    </View>
  );
}

/**
 * One entry deleted, with Undo (SE-12: what can be undone acts at once). It
 * leaves the list now and the history when the next one is deleted, when
 * everything is, or when the pane closes; Undo brings it back untouched.
 */
function usePendingDelete(source: Source): { pending: HistoryEntry | null; remove: (entry: HistoryEntry) => void; undo: () => void; settle: () => void } {
  const [pending, setPending] = useState<HistoryEntry | null>(null);
  const held = useRef<HistoryEntry | null>(null);
  const settle = (): void => {
    if (held.current) source.history.remove(held.current.id);
    held.current = null;
    setPending(null);
  };
  useEffect(
    () => () => {
      if (held.current) source.history.remove(held.current.id);
    },
    [source],
  );
  return {
    pending,
    remove: (entry) => {
      settle();
      held.current = entry;
      setPending(entry);
    },
    undo: () => {
      held.current = null;
      setPending(null);
    },
    settle,
  };
}

export function DictationHistoryRows({ settings, source, guard }: { settings: SettingsStore; source: Source; guard: PersonOnly }) {
  const all = useSyncExternalStore(source.history.subscribe, source.history.getSnapshot);
  const chosen = useSettings(settings).data.dictation.history;
  const keep: HistoryKeep = isHistoryKeep(chosen) ? chosen : "day";
  const [open, setOpen] = useState(false);
  const deleting = usePendingDelete(source);
  const entries = all.filter((entry) => entry.id !== deleting.pending?.id);
  const shown = open ? entries : entries.slice(0, FIRST);
  return (
    <>
      <Caption above>Dictation history</Caption>
      <Group testID="voice-dictation-history">
        <Setting id="voice/dictation-history" testID="voice-dictation-keep" {...(guard.refused === "voice/dictation-history" ? { detail: ONLY_YOU } : {})}>
          <FoldedChoices
            testID="voice-dictation-keep-choice"
            value={keep}
            options={KEEP_OPTIONS}
            onChange={(next) => guard.mine("voice/dictation-history", () => settings.patch("dictation", { history: next === "day" ? undefined : next }))}
          />
        </Setting>
      </Group>
      {keep !== "none" && (
        // The entries are a list of things, on a card of their own: no knobs beside the setting's (SE-6, SE-13).
        <Group testID="voice-dictation-entries">
          {entries.length === 0 && <Note testID="dictation-history-empty">Nothing dictated yet. What you dictate is listed here.</Note>}
          {shown.map((entry) => (
            <Entry key={entry.id} entry={entry} source={source} onDelete={() => guard.mine("voice/dictation-history", () => deleting.remove(entry))} />
          ))}
          {entries.length > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, minHeight: PAGE.row, paddingHorizontal: PAGE.inset }}>
              <View style={{ flex: 1 }}>
                {entries.length > FIRST && (
                  <MoreButton testID="dictation-history-all" open={open} more={`Show all ${entries.length}`} less="Show fewer" onPress={() => setOpen(!open)} />
                )}
              </View>
              <ConfirmDelete
                testID="dictation-history-clear"
                verb="Delete all"
                onDelete={() =>
                  guard.mine("voice/dictation-history", () => {
                    deleting.settle();
                    source.history.clear();
                  })
                }
              />
            </View>
          )}
        </Group>
      )}
      {deleting.pending !== null ? (
        <View testID="dictation-history-deleted" style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m, paddingRight: PAGE.inset, ...TUCK }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Caption>{`Deleted “${deleting.pending.typed}”.`}</Caption>
          </View>
          <MiniButton testID="dictation-history-undo" label="Undo" onPress={() => guard.mine("voice/dictation-history", deleting.undo)} />
        </View>
      ) : (
        <Caption>Kept on this computer only, never the sound. Nothing is kept from a password field.</Caption>
      )}
    </>
  );
}
