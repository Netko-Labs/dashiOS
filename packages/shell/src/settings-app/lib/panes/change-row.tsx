/**
 * One entry of Settings' change log (changes/), as Recently changed and
 * Settings › Agents list it: what it is now ("Dark Mode on", "Text size:
 * Larger"), then one plain line, who and what it was and when ("by you ·
 * was on, 10 min ago"; an agent by its name in shiso, as agents are marked
 * everywhere); Undo while it can be.
 * Pressing the words opens the setting's pane at its row.
 */

import { SPACE, TYPE, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { Actor } from "../../../acting.ts";
import { ago } from "../../../agents/ask/history.ts";
import { useColors } from "../../colors.ts";
import type { ChangeEntry } from "../changes/log.ts";
import { changeLine } from "../changes/words.ts";
import { PAGE } from "../row.tsx";
import { MiniButton } from "./parts.tsx";

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
  const words = { fontSize: TYPE.panel.detail.size, color: colors.textMuted } as const;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, minWidth: 0 }}>
      <Text style={words}>by</Text>
      <View {...(entry.by ? { testID: "change-by-agent" } : {})} style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={entry.by ? { ...words, fontWeight: WEIGHT.semibold, color: colors.agentInk } : words}>
          {changedBy(entry.by)}
        </Text>
      </View>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={words}>{`· ${changeDetail(entry)}`}</Text>
      </View>
    </View>
  );
}

/**
 * A change as a card's row (SE-8): what it is now, 13.5 SemiBold, over who
 * and when, 11.5; Undo at the row's end (the 28 pill, SE-11). A row that
 * opens its setting is a Tab stop, a link (SE-A18).
 */
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
  const line = changeLine(entry.words);
  return (
    <View
      testID={testID}
      style={{ flexDirection: "row", alignItems: "center", gap: PAGE.gap, minHeight: PAGE.row, paddingHorizontal: PAGE.inset, paddingVertical: PAGE.pad }}
    >
      <View
        {...(onOpen
          ? { onPress: onOpen, focusable: true, accessibilityRole: "link" as const, accessibilityLabel: line, focusRingColor: colors.focusRing }
          : {})}
        style={{ flex: 1, flexDirection: "column", gap: SPACE.px, minWidth: 0 }}
      >
        <Text numberOfLines={1} style={{ fontSize: TYPE.panel.name.size, fontWeight: WEIGHT.semibold, color: entry.undone ? colors.textMuted : colors.text }}>
          {line}
        </Text>
        <ChangeLine entry={entry} />
      </View>
      {entry.undone ? (
        <Text style={{ fontSize: TYPE.panel.detail.size, color: colors.textMuted }}>Undone</Text>
      ) : (
        canUndo && <MiniButton testID={`${testID}:undo`} label="Undo" onPress={onUndo} />
      )}
    </View>
  );
}
