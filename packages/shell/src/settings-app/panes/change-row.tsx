/**
 * One entry of Settings' change log (changes/), as Recently changed and
 * Settings › Agents list it: what it is now ("Dark Mode on", "Text size:
 * Larger"), then one plain line, who and what it was and when ("by you ·
 * was on, 10 min ago"; an agent by its name in shiso, as agents are marked
 * everywhere); Undo while it can be.
 * Pressing the words opens the setting's pane at its row.
 */

import { Text, View } from "@mirinjs/metal";
import type { Actor } from "../../acting.ts";
import { ago } from "../../agents/ask/history.ts";
import { type ChangeEntry, changeLine } from "../changes/index.ts";
import { useColors } from "../colors.ts";
import { Button } from "../ui.tsx";

/** Who changed it, in words: "you", or the agent by its name. */
export function changedBy(by: Pick<Actor, "agent"> | null): string {
  return by ? by.agent : "you";
}

/** The line under a change, after "by <who>": "was on, 10 min ago". */
export function changeDetail(entry: Pick<ChangeEntry, "words" | "at">, now: number = Date.now()): string {
  return `was ${entry.words.from}, ${ago(Math.floor(entry.at / 1000), Math.floor(now / 1000))}`;
}

/** "by you · was on, 10 min ago", the agent's name in shiso. */
function ChangeLine({ entry }: { entry: ChangeEntry }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
      <Text style={{ fontSize: 11.5, color: colors.textMuted }}>by</Text>
      <View {...(entry.by ? { testID: "change-by-agent" } : {})} style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: entry.by ? "semibold" : "normal", color: entry.by ? colors.agentInk : colors.textMuted }}>
          {changedBy(entry.by)}
        </Text>
      </View>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.textMuted }}>{`· ${changeDetail(entry)}`}</Text>
      </View>
    </View>
  );
}

export function ChangeRow({
  entry,
  canUndo,
  onUndo,
  onOpen,
  testID,
}: {
  entry: ChangeEntry;
  canUndo: boolean;
  onUndo: () => void;
  onOpen?: (() => void) | undefined;
  testID: string;
}) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 12, paddingVertical: 6 }}>
      <View {...(onOpen ? { onPress: onOpen, accessibilityRole: "link" as const } : {})} style={{ flex: 1, flexDirection: "column", gap: 3, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: entry.undone ? colors.textMuted : colors.text }}>
          {changeLine(entry.words)}
        </Text>
        <ChangeLine entry={entry} />
      </View>
      {entry.undone ? (
        <Text style={{ fontSize: 11, color: colors.textMuted }}>Undone</Text>
      ) : (
        canUndo && <Button testID={`${testID}:undo`} label="Undo" onPress={onUndo} />
      )}
    </View>
  );
}
