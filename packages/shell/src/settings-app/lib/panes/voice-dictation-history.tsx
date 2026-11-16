/**
 * Settings › Voice › Dictation's history (voice.tsx; dictation/history.ts):
 * what was dictated in the last day, the newest first, the words as they
 * were heard beside the words that were typed, each with Copy and Delete;
 * how long it is kept, and "Nothing". Only the person's own press changes
 * how long, or deletes.
 */

import { Text, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import type { HistoryEntry } from "../../../dictation/index.ts";
import { Caption, Group, Note } from "../../../shared/cards/index.ts";
import { FoldedChoices } from "../../../shared/controls/folded.tsx";
import { HISTORY_KEEPS, type HistoryKeep, isHistoryKeep } from "../../../shared/pill/index.ts";
import { useColors } from "../../colors.ts";
import type { PaneContext } from "../../context.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { ONLY_YOU, type PersonOnly } from "../person-only.ts";
import { PAGE } from "../row.tsx";
import { Setting } from "../setting.tsx";
import { MiniButton } from "./parts.tsx";

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

function Words({ label, text, testID }: { label: string; text: string; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flex: 1, flexDirection: "column", gap: 2, minWidth: 0 }}>
      <Text style={{ fontSize: 10.5, fontWeight: "semibold", color: colors.textMuted }}>{label}</Text>
      <Text style={{ fontSize: 13, color: colors.text }}>{text}</Text>
    </View>
  );
}

function Entry({ entry, source, guard }: { entry: HistoryEntry; source: Source; guard: PersonOnly }) {
  const colors = useColors();
  const same = entry.heard === entry.typed;
  return (
    <View
      testID={`dictation-history:${entry.id}`}
      style={{ flexDirection: "column", gap: 6, paddingLeft: PAGE.inset, paddingRight: PAGE.inset, paddingVertical: 10 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.textMuted }}>
            {whenWords(entry)}
          </Text>
        </View>
        <MiniButton testID={`dictation-history-copy:${entry.id}`} label="Copy" onPress={() => source.copy(entry.typed)} />
        {!same && <MiniButton testID={`dictation-history-copy-heard:${entry.id}`} label="Copy as heard" onPress={() => source.copy(entry.heard)} />}
        <MiniButton
          testID={`dictation-history-delete:${entry.id}`}
          label="Delete"
          tone="critical"
          onPress={() => guard.mine("voice/dictation-history", () => source.history.remove(entry.id))}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 14 }}>
        {!same && <Words label="Heard" text={entry.heard} testID={`dictation-history-heard:${entry.id}`} />}
        <Words label={same ? "Typed as heard" : "Typed"} text={entry.typed} testID={`dictation-history-typed:${entry.id}`} />
      </View>
    </View>
  );
}

export function DictationHistoryRows({ settings, source, guard }: { settings: SettingsStore; source: Source; guard: PersonOnly }) {
  const entries = useSyncExternalStore(source.history.subscribe, source.history.getSnapshot);
  const chosen = useSettings(settings).data.dictation.history;
  const keep: HistoryKeep = isHistoryKeep(chosen) ? chosen : "day";
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, FIRST);
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
        {keep !== "none" && entries.length === 0 && <Note testID="dictation-history-empty">Nothing dictated yet.</Note>}
        {shown.map((entry) => (
          <Entry key={entry.id} entry={entry} source={source} guard={guard} />
        ))}
        {entries.length > 0 && (
          <View style={{ flexDirection: "row", gap: 8, paddingLeft: PAGE.inset, paddingRight: PAGE.inset, paddingVertical: 8 }}>
            {entries.length > FIRST && (
              <MiniButton testID="dictation-history-all" label={all ? "Show fewer" : `Show all ${entries.length}`} onPress={() => setAll(!all)} />
            )}
            <MiniButton
              testID="dictation-history-clear"
              label="Delete all"
              tone="critical"
              onPress={() => guard.mine("voice/dictation-history", () => source.history.clear())}
            />
          </View>
        )}
      </Group>
      <Caption>Kept on this computer only, never the sound. Nothing is kept from a password field.</Caption>
    </>
  );
}
