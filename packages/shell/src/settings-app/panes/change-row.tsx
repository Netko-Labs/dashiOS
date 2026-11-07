/**
 * One entry of Settings' change log (changes/), as Recently changed and
 * Settings › Agents list it: what it is now ("Dark Mode on", "Text size:
 * Larger"), who changed it (you, or the agent by name in shiso, as agents
 * are marked everywhere), what it was, and when; Undo while it can be.
 * Pressing the words opens the setting's pane at its row.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { Actor } from "../../acting.ts";
import { ago } from "../../agents/ask/history.ts";
import { type ChangeEntry, changeLine } from "../changes/index.ts";
import { Button } from "../ui.tsx";

/** Who changed it: an agent's name on shiso's wash, or "You". */
export function ByChip({ by }: { by: Actor | null }) {
  const colors = useColors();
  if (!by) return <Text style={{ fontSize: 11, color: colors.textMuted }}>You</Text>;
  return (
    <View testID="change-by-agent" style={{ height: 16, paddingHorizontal: 6, borderRadius: 8, justifyContent: "center", backgroundColor: colors.agentWash }}>
      <Text numberOfLines={1} style={{ fontSize: 11, color: colors.agentInk }}>
        {by.agent}
      </Text>
    </View>
  );
}

/** "was Default · 2 min ago". */
export function changeDetail(entry: Pick<ChangeEntry, "words" | "at">, now: number = Date.now()): string {
  return `was ${entry.words.from} · ${ago(Math.floor(entry.at / 1000), Math.floor(now / 1000))}`;
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <ByChip by={entry.by} />
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
            {changeDetail(entry)}
          </Text>
        </View>
      </View>
      {entry.undone ? (
        <Text style={{ fontSize: 11, color: colors.textMuted }}>Undone</Text>
      ) : (
        canUndo && <Button testID={`${testID}:undo`} label="Undo" onPress={onUndo} />
      )}
    </View>
  );
}
